// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice FROZEN external interface (lead, 14:33). LeashWallet must implement exactly this.
/// Node ids start at 1. Node id 0 means "none" (root parent) and "global" in PayeeNotAllowed(0).
interface ILeashWallet {
    struct Node {
        address key;
        uint256 parent; // 0 for root
        uint256 depth; // root 0, child 1, grandchild 2
        uint256 cap; // token atomic units
        uint256 spent;
        uint256 maxPerCall;
        uint256 expiry; // unix seconds; Expired when block.timestamp >= expiry
        bool paused;
        bool restricted; // if true, payee must also be in nodeAllow[id]
    }

    /// Signed (EIP-712) by the PARENT node's key. Relayed by anyone (facilitator POST /delegate).
    /// Typed struct: CreateChild(uint256 parentId,address key,uint256 cap,uint256 maxPerCall,uint256 expiry,bool restricted,bytes32 payeesHash,uint256 nonce,uint256 deadline)
    /// payeesHash = keccak256(abi.encodePacked(payees))  == viem keccak256(encodePacked(["address[]"], [payees]))
    struct ChildParams {
        uint256 parentId;
        address key;
        uint256 cap;
        uint256 maxPerCall;
        uint256 expiry;
        bool restricted;
        address[] payees;
        uint256 nonce;
        uint256 deadline;
    }

    // EIP-712 domain for delegations: {name "Leash", version "1", chainId, verifyingContract = this}
    // PauseChild(uint256 target,uint256 nonce,uint256 deadline) signed by a STRICT ANCESTOR node key of target.

    error UnknownAgent(address signer);
    error PayeeNotAllowed(uint256 node);
    error OverPerCall(uint256 node);
    error OverBudget(uint256 node);
    error Expired(uint256 node);
    error Paused(uint256 node);
    error BelowFloor();
    error TooDeep();
    error ChildExceedsParent();
    error BadDelegation();
    error KeyInUse();
    error NotAncestor();
    error NotOwner();

    event NodeCreated(uint256 indexed id, uint256 indexed parent, address key, uint256 cap, uint256 maxPerCall, uint256 expiry);
    event Paid(uint256 indexed id, address indexed to, uint256 value, bytes32 nonce);
    event NodePaused(uint256 indexed id, address by);
    event NodeUnpaused(uint256 indexed id);
    event CapRaised(uint256 indexed id, uint256 oldCap, uint256 newCap);
    event AllowSet(address indexed payee, bool allowed);

    // payments
    function settle(address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes calldata signature) external;
    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4);

    // tree
    function createRoot(address key, uint256 cap, uint256 maxPerCall, uint256 expiry) external returns (uint256 id); // owner
    function createChild(ChildParams calldata c, bytes calldata parentSig) external returns (uint256 id); // anyone relays
    function pauseChild(uint256 target, uint256 nonce, uint256 deadline, bytes calldata ancestorSig) external; // anyone relays

    // owner
    function pause(uint256 id) external;
    function unpause(uint256 id) external;
    function raiseCap(uint256 id, uint256 newCap) external;
    function setAllow(address payee, bool allowed) external;
    function setFloor(uint256 newFloor) external;
    function withdraw(address to, uint256 amount) external;

    // views
    function getNode(uint256 id) external view returns (Node memory);
    function remaining(uint256 id) external view returns (uint256); // min over self+ancestors of cap - spent
    function nodeCount() external view returns (uint256);
    function nodeOfKey(address key) external view returns (uint256);
    function allowlist(address payee) external view returns (bool);
    function nodeAllow(uint256 id, address payee) external view returns (bool);
    function usedDelegation(bytes32 structHash) external view returns (bool);
    function floor() external view returns (uint256);
    function owner() external view returns (address);
    function AUSD() external view returns (address);
    function DELEGATION_DOMAIN_SEPARATOR() external view returns (bytes32);
}
