// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {LeashWallet} from "../src/LeashWallet.sol";
import {ILeashWallet} from "../src/ILeashWallet.sol";
import {MockAUSD} from "../src/mocks/MockAUSD.sol";

abstract contract BaseTest is Test {
    bytes32 constant TWA_TYPEHASH = 0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267;
    bytes32 constant CREATE_CHILD_TYPEHASH = keccak256(
        "CreateChild(uint256 parentId,address key,uint256 cap,uint256 maxPerCall,uint256 expiry,bool restricted,bytes32 payeesHash,uint256 nonce,uint256 deadline)"
    );
    bytes32 constant PAUSE_CHILD_TYPEHASH = keccak256("PauseChild(uint256 target,uint256 nonce,uint256 deadline)");

    uint256 constant U = 1e6; // 1 AUSD (6 decimals)

    MockAUSD ausd;
    LeashWallet wallet;
    address owner = makeAddr("owner");
    address payeeA = makeAddr("payeeSearch");
    address payeeB = makeAddr("payeeScrape");
    address attacker = makeAddr("attacker");

    uint256 rootPk = 0xA11CE;
    address rootKey;
    uint256 rootExpiry;
    uint256 nonceCounter;

    function setUp() public virtual {
        vm.warp(1_791_700_000);
        ausd = new MockAUSD();
        wallet = new LeashWallet(address(ausd), owner);
        ausd.mint(address(wallet), 5 * U);
        rootKey = vm.addr(rootPk);
        rootExpiry = block.timestamp + 1 days;
        vm.startPrank(owner);
        wallet.setAllow(payeeA, true);
        wallet.setAllow(payeeB, true);
        wallet.createRoot(rootKey, 1 * U, U / 10, rootExpiry);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ payments

    struct Auth {
        address to;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        bytes sig;
    }

    function _auth(uint256 pk, address to, uint256 value) internal returns (Auth memory a) {
        a.to = to;
        a.value = value;
        a.validAfter = block.timestamp - 5;
        a.validBefore = block.timestamp + 120;
        a.nonce = keccak256(abi.encode("nonce", ++nonceCounter));
        bytes32 digest = _twaDigest(address(wallet), a);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        a.sig = abi.encodePacked(r, s, v);
    }

    function _twaDigest(address from, Auth memory a) internal view returns (bytes32) {
        bytes32 sh = keccak256(abi.encode(TWA_TYPEHASH, from, a.to, a.value, a.validAfter, a.validBefore, a.nonce));
        return keccak256(abi.encodePacked("\x19\x01", ausd.DOMAIN_SEPARATOR(), sh));
    }

    function _settle(Auth memory a) internal {
        wallet.settle(a.to, a.value, a.validAfter, a.validBefore, a.nonce, a.sig);
    }

    function _pay(uint256 pk, address to, uint256 value) internal {
        _settle(_auth(pk, to, value));
    }

    function _expectPayRevert(uint256 pk, address to, uint256 value, bytes memory err) internal {
        Auth memory a = _auth(pk, to, value);
        vm.expectRevert(err);
        _settle(a);
    }

    // ------------------------------------------------------------ delegations

    function _params(uint256 parentId, address key, uint256 cap, uint256 mpc, uint256 expiry)
        internal
        returns (ILeashWallet.ChildParams memory c)
    {
        c.parentId = parentId;
        c.key = key;
        c.cap = cap;
        c.maxPerCall = mpc;
        c.expiry = expiry;
        c.restricted = false;
        c.payees = new address[](0);
        c.nonce = ++nonceCounter;
        c.deadline = block.timestamp + 300;
    }

    function _childStructHash(ILeashWallet.ChildParams memory c) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                CREATE_CHILD_TYPEHASH,
                c.parentId,
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
    }

    function _signDelegation(uint256 pk, bytes32 structHash) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", wallet.DELEGATION_DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signChild(uint256 pk, ILeashWallet.ChildParams memory c) internal view returns (bytes memory) {
        return _signDelegation(pk, _childStructHash(c));
    }

    function _createChild(uint256 parentPk, ILeashWallet.ChildParams memory c) internal returns (uint256) {
        return wallet.createChild(c, _signChild(parentPk, c));
    }

    /// Unrestricted child with given cap and maxPerCall, expiry = root expiry.
    function _child(uint256 parentPk, uint256 parentId, uint256 childPk, uint256 cap, uint256 mpc)
        internal
        returns (uint256)
    {
        return _createChild(parentPk, _params(parentId, vm.addr(childPk), cap, mpc, rootExpiry));
    }

    function _pauseSig(uint256 pk, uint256 target, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        return _signDelegation(pk, keccak256(abi.encode(PAUSE_CHILD_TYPEHASH, target, nonce, deadline)));
    }
}
