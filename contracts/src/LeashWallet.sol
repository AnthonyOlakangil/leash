// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ILeashWallet} from "./ILeashWallet.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Minimal surface of AUSD used by LeashWallet.
interface IAUSD {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function balanceOf(address account) external view returns (uint256);
    /// @dev bytes-signature overload, selector 0xcf092995 (ecrecover first, then ERC-1271 fallback).
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external;
}

/// @title LeashWallet
/// @notice Holds AUSD for a tree of AI agent nodes. Agents sign standard ERC-3009 authorizations with
/// from = this wallet; settle() enforces the whole ancestor chain's rules, then flags the exact digest in
/// EIP-1153 transient storage so AUSD's ERC-1271 callback accepts it only for the duration of that call.
contract LeashWallet is ILeashWallet, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- constants

    /// keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")
    bytes32 public constant TWA_TYPEHASH = 0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267;

    bytes32 public constant CREATE_CHILD_TYPEHASH = keccak256(
        "CreateChild(uint256 parentId,address key,uint256 cap,uint256 maxPerCall,uint256 expiry,bool restricted,bytes32 payeesHash,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant PAUSE_CHILD_TYPEHASH = keccak256("PauseChild(uint256 target,uint256 nonce,uint256 deadline)");

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("Leash");
    bytes32 private constant VERSION_HASH = keccak256("1");

    /// Salt for the transient approval slot: slot = keccak256(abi.encode(digest, APPROVAL_SALT)).
    bytes32 public constant APPROVAL_SALT = keccak256("leash.approval.v1");

    uint256 public constant MAX_DEPTH = 2;

    bytes4 private constant MAGIC_1271 = 0x1626ba7e;
    bytes4 private constant INVALID_1271 = 0xffffffff;

    // ---------------------------------------------------------------- storage

    address public immutable AUSD;
    address public immutable owner;

    uint256 public floor;
    uint256 private _nodeCount;

    mapping(uint256 => Node) private _nodes;
    mapping(address key => uint256) public nodeOfKey;
    mapping(address payee => bool) public allowlist;
    mapping(uint256 id => mapping(address payee => bool)) public nodeAllow;
    mapping(bytes32 structHash => bool) public usedDelegation;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address ausd, address owner_) {
        AUSD = ausd;
        owner = owner_;
    }

    // ---------------------------------------------------------------- payments

    /// @inheritdoc ILeashWallet
    function settle(
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external nonReentrant {
        // 2-3. Exact digest AUSD will compute for this authorization (from = this wallet).
        bytes32 structHash =
            keccak256(abi.encode(TWA_TYPEHASH, address(this), to, value, validAfter, validBefore, nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", IAUSD(AUSD).DOMAIN_SEPARATOR(), structHash));

        // 4. Signer must be a known node key (OZ ECDSA: low-s enforced, reverts on malformed sigs).
        address signer = ECDSA.recoverCalldata(digest, signature);
        uint256 id = nodeOfKey[signer];
        if (id == 0) revert UnknownAgent(signer);

        // 5. Global payee allowlist.
        if (!allowlist[to]) revert PayeeNotAllowed(0);

        // 6. Check and charge every node from the signer up to the root.
        uint256 n = id;
        while (n != 0) {
            Node storage node = _nodes[n];
            if (node.paused) revert Paused(n);
            if (block.timestamp >= node.expiry) revert Expired(n);
            if (value > node.maxPerCall) revert OverPerCall(n);
            if (node.restricted && !nodeAllow[n][to]) revert PayeeNotAllowed(n);
            if (node.spent + value > node.cap) revert OverBudget(n);
            node.spent += value;
            n = node.parent;
        }

        // 7. Balance floor.
        if (IAUSD(AUSD).balanceOf(address(this)) < value + floor) revert BelowFloor();

        // 8. Approve exactly this digest for the duration of the token call only.
        bytes32 slot = _approvalSlot(digest);
        assembly ("memory-safe") {
            tstore(slot, 1)
        }
        IAUSD(AUSD).transferWithAuthorization(address(this), to, value, validAfter, validBefore, nonce, signature);
        assembly ("memory-safe") {
            tstore(slot, 0)
        }

        // 9.
        emit Paid(id, to, value, nonce);
    }

    /// @notice ERC-1271. Valid ONLY when called by AUSD for a digest flagged inside settle().
    /// View + TLOAD only (TSTORE is illegal under STATICCALL). The wallet therefore can never sign
    /// permits or anything else outside a settle() in progress.
    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4) {
        signature; // unused: AUSD already verified the agent's ECDSA sig; we gate on the flagged digest only
        if (msg.sender != AUSD) return INVALID_1271;
        bytes32 slot = _approvalSlot(digest);
        uint256 flag;
        assembly ("memory-safe") {
            flag := tload(slot)
        }
        return flag == 1 ? MAGIC_1271 : INVALID_1271;
    }

    // ---------------------------------------------------------------- tree

    /// @inheritdoc ILeashWallet
    function createRoot(address key, uint256 cap, uint256 maxPerCall, uint256 expiry)
        external
        onlyOwner
        returns (uint256 id)
    {
        _checkKey(key);
        id = ++_nodeCount;
        _nodes[id] = Node({
            key: key,
            parent: 0,
            depth: 0,
            cap: cap,
            spent: 0,
            maxPerCall: maxPerCall,
            expiry: expiry,
            paused: false,
            restricted: false
        });
        nodeOfKey[key] = id;
        emit NodeCreated(id, 0, key, cap, maxPerCall, expiry);
    }

    /// @inheritdoc ILeashWallet
    function createChild(ChildParams calldata c, bytes calldata parentSig) external returns (uint256 id) {
        if (block.timestamp > c.deadline) revert BadDelegation();
        uint256 pid = c.parentId;
        if (pid == 0 || pid > _nodeCount) revert BadDelegation();

        bytes32 structHash = keccak256(
            abi.encode(
                CREATE_CHILD_TYPEHASH,
                pid,
                c.key,
                c.cap,
                c.maxPerCall,
                c.expiry,
                c.restricted,
                keccak256(abi.encodePacked(c.payees)),
                c.nonce,
                c.deadline
            )
        );
        if (usedDelegation[structHash]) revert BadDelegation();

        Node storage parent = _nodes[pid];
        address signer = ECDSA.recoverCalldata(_delegationDigest(structHash), parentSig);
        if (signer != parent.key) revert BadDelegation();

        if (parent.paused) revert Paused(pid);
        if (block.timestamp >= parent.expiry) revert Expired(pid);
        if (parent.depth + 1 > MAX_DEPTH) revert TooDeep();
        if (c.cap > parent.cap || c.maxPerCall > parent.maxPerCall || c.expiry > parent.expiry) {
            revert ChildExceedsParent();
        }
        _checkKey(c.key);

        usedDelegation[structHash] = true;

        id = ++_nodeCount;
        _nodes[id] = Node({
            key: c.key,
            parent: pid,
            depth: parent.depth + 1,
            cap: c.cap,
            spent: 0,
            maxPerCall: c.maxPerCall,
            expiry: c.expiry,
            paused: false,
            restricted: c.restricted
        });
        nodeOfKey[c.key] = id;

        bool parentRestricted = parent.restricted;
        for (uint256 i = 0; i < c.payees.length; ++i) {
            address p = c.payees[i];
            // A restricted parent's child may only list payees the parent allows.
            if (parentRestricted && !nodeAllow[pid][p]) revert ChildExceedsParent();
            nodeAllow[id][p] = true;
        }

        emit NodeCreated(id, pid, c.key, c.cap, c.maxPerCall, c.expiry);
    }

    /// @inheritdoc ILeashWallet
    function pauseChild(uint256 target, uint256 nonce, uint256 deadline, bytes calldata ancestorSig) external {
        if (block.timestamp > deadline) revert BadDelegation();
        if (target == 0 || target > _nodeCount) revert NotAncestor();

        bytes32 structHash = keccak256(abi.encode(PAUSE_CHILD_TYPEHASH, target, nonce, deadline));
        if (usedDelegation[structHash]) revert BadDelegation();

        address signer = ECDSA.recoverCalldata(_delegationDigest(structHash), ancestorSig);
        uint256 signerId = nodeOfKey[signer];
        if (signerId == 0) revert NotAncestor();

        // signer must be a STRICT ancestor of target
        uint256 n = _nodes[target].parent;
        while (n != 0 && n != signerId) {
            n = _nodes[n].parent;
        }
        if (n == 0) revert NotAncestor();

        usedDelegation[structHash] = true;
        _nodes[target].paused = true;
        emit NodePaused(target, signer);
    }

    // ---------------------------------------------------------------- owner

    function pause(uint256 id) external onlyOwner {
        _checkExists(id);
        _nodes[id].paused = true;
        emit NodePaused(id, msg.sender);
    }

    function unpause(uint256 id) external onlyOwner {
        _checkExists(id);
        _nodes[id].paused = false;
        emit NodeUnpaused(id);
    }

    function raiseCap(uint256 id, uint256 newCap) external onlyOwner {
        _checkExists(id);
        uint256 oldCap = _nodes[id].cap;
        _nodes[id].cap = newCap;
        emit CapRaised(id, oldCap, newCap);
    }

    function setAllow(address payee, bool allowed) external onlyOwner {
        allowlist[payee] = allowed;
        emit AllowSet(payee, allowed);
    }

    function setFloor(uint256 newFloor) external onlyOwner {
        floor = newFloor;
    }

    function withdraw(address to, uint256 amount) external onlyOwner {
        IERC20(AUSD).safeTransfer(to, amount);
    }

    // ---------------------------------------------------------------- views

    function getNode(uint256 id) external view returns (Node memory) {
        return _nodes[id];
    }

    /// @notice min over self and every ancestor of (cap - spent), saturating at 0. 0 for unknown ids.
    function remaining(uint256 id) external view returns (uint256) {
        if (id == 0 || id > _nodeCount) return 0;
        uint256 r = type(uint256).max;
        uint256 n = id;
        while (n != 0) {
            Node storage node = _nodes[n];
            uint256 left = node.cap > node.spent ? node.cap - node.spent : 0;
            if (left < r) r = left;
            n = node.parent;
        }
        return r;
    }

    function nodeCount() external view returns (uint256) {
        return _nodeCount;
    }

    function DELEGATION_DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    // ---------------------------------------------------------------- internal

    function _approvalSlot(bytes32 digest) private pure returns (bytes32) {
        return keccak256(abi.encode(digest, APPROVAL_SALT));
    }

    function _delegationDigest(bytes32 structHash) private view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", DELEGATION_DOMAIN_SEPARATOR(), structHash));
    }

    /// Key hygiene: not zero, not owner, not this wallet, not already a node key.
    function _checkKey(address key) private view {
        if (key == address(0) || key == owner || key == address(this) || nodeOfKey[key] != 0) revert KeyInUse();
    }

    function _checkExists(uint256 id) private view {
        if (id == 0 || id > _nodeCount) revert UnknownAgent(address(0));
    }
}
