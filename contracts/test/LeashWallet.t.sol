// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {ILeashWallet} from "../src/ILeashWallet.sol";
import {LeashWallet} from "../src/LeashWallet.sol";
import {MockAUSD} from "../src/mocks/MockAUSD.sol";

contract LeashWalletTest is BaseTest {
    uint256 constant C1 = 0xC1; // child 1 key
    uint256 constant C2 = 0xC2; // child 2 key
    uint256 constant G1 = 0x61; // grandchild key

    // ============================================================ constants / setup

    function test_typehash_constant() public view {
        assertEq(
            TWA_TYPEHASH,
            keccak256(
                "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
            )
        );
        assertEq(wallet.TWA_TYPEHASH(), TWA_TYPEHASH);
        assertEq(wallet.APPROVAL_SALT(), keccak256("leash.approval.v1"));
    }

    function test_constructor_and_root() public view {
        assertEq(wallet.AUSD(), address(ausd));
        assertEq(wallet.owner(), owner);
        assertEq(wallet.nodeCount(), 1);
        assertEq(wallet.nodeOfKey(rootKey), 1);
        ILeashWallet.Node memory n = wallet.getNode(1);
        assertEq(n.key, rootKey);
        assertEq(n.parent, 0);
        assertEq(n.depth, 0);
        assertEq(n.cap, U);
        assertEq(n.maxPerCall, U / 10);
        assertEq(n.expiry, rootExpiry);
        assertTrue(wallet.allowlist(payeeA));
    }

    function test_delegation_domain_separator() public view {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Leash"),
                keccak256("1"),
                block.chainid,
                address(wallet)
            )
        );
        assertEq(wallet.DELEGATION_DOMAIN_SEPARATOR(), expected);
    }

    // ============================================================ happy paths

    function test_depth1_root_pays() public {
        Auth memory a = _auth(rootPk, payeeA, 2 * U / 100);
        vm.expectEmit(true, true, false, true, address(wallet));
        emit ILeashWallet.Paid(1, payeeA, a.value, a.nonce);
        _settle(a);
        assertEq(ausd.balanceOf(payeeA), a.value);
        assertEq(ausd.balanceOf(address(wallet)), 5 * U - a.value);
        assertEq(wallet.getNode(1).spent, a.value);
        assertEq(wallet.remaining(1), U - a.value);
    }

    function test_depth2_child_pays_increments_both() public {
        uint256 c = _child(rootPk, 1, C1, U / 4, U / 10);
        assertEq(c, 2);
        assertEq(wallet.getNode(2).depth, 1);
        _pay(C1, payeeB, 5 * U / 100);
        assertEq(wallet.getNode(2).spent, 5 * U / 100);
        assertEq(wallet.getNode(1).spent, 5 * U / 100);
        assertEq(ausd.balanceOf(payeeB), 5 * U / 100);
    }

    function test_depth3_grandchild_pays_increments_all_three() public {
        _child(rootPk, 1, C1, U / 4, U / 10);
        uint256 g = _child(C1, 2, G1, U / 10, U / 20);
        assertEq(g, 3);
        assertEq(wallet.getNode(3).depth, 2);
        assertEq(wallet.getNode(3).parent, 2);
        _pay(G1, payeeA, 2 * U / 100);
        assertEq(wallet.getNode(3).spent, 2 * U / 100);
        assertEq(wallet.getNode(2).spent, 2 * U / 100);
        assertEq(wallet.getNode(1).spent, 2 * U / 100);
        assertEq(wallet.remaining(3), U / 10 - 2 * U / 100);
    }

    function test_remaining_is_min_over_ancestors() public {
        _child(rootPk, 1, C1, U / 4, U / 10);
        _child(rootPk, 1, C2, U / 4, U / 10);
        vm.prank(owner);
        wallet.raiseCap(1, 3 * U / 10); // root cap 0.30
        _pay(C1, payeeA, U / 10);
        _pay(C1, payeeA, U / 10); // root spent 0.20
        assertEq(wallet.remaining(3), U / 10); // child2 has 0.25 left but root only 0.10
        assertEq(wallet.remaining(99), 0);
    }

    function test_event_NodeCreated() public {
        ILeashWallet.ChildParams memory c = _params(1, vm.addr(C1), U / 4, U / 10, rootExpiry);
        bytes memory sig = _signChild(rootPk, c);
        vm.expectEmit(true, true, false, true, address(wallet));
        emit ILeashWallet.NodeCreated(2, 1, vm.addr(C1), U / 4, U / 10, rootExpiry);
        wallet.createChild(c, sig);
    }

    // ============================================================ settle errors

    function test_UnknownAgent() public {
        uint256 pk = 0xBAD;
        _expectPayRevert(pk, payeeA, 1, abi.encodeWithSelector(ILeashWallet.UnknownAgent.selector, vm.addr(pk)));
    }

    function test_PayeeNotAllowed_global() public {
        _expectPayRevert(rootPk, attacker, 1, abi.encodeWithSelector(ILeashWallet.PayeeNotAllowed.selector, 0));
    }

    function test_PayeeNotAllowed_node_level() public {
        ILeashWallet.ChildParams memory c = _params(1, vm.addr(C1), U / 4, U / 10, rootExpiry);
        c.restricted = true;
        c.payees = new address[](1);
        c.payees[0] = payeeA;
        _createChild(rootPk, c);
        assertTrue(wallet.nodeAllow(2, payeeA));
        assertFalse(wallet.nodeAllow(2, payeeB));
        _pay(C1, payeeA, U / 100);
        _expectPayRevert(C1, payeeB, U / 100, abi.encodeWithSelector(ILeashWallet.PayeeNotAllowed.selector, 2));
    }

    function test_PayeeNotAllowed_inherited_from_restricted_ancestor() public {
        ILeashWallet.ChildParams memory c = _params(1, vm.addr(C1), U / 4, U / 10, rootExpiry);
        c.restricted = true;
        c.payees = new address[](1);
        c.payees[0] = payeeA;
        _createChild(rootPk, c);
        _child(C1, 2, G1, U / 10, U / 20); // unrestricted grandchild
        _expectPayRevert(G1, payeeB, U / 100, abi.encodeWithSelector(ILeashWallet.PayeeNotAllowed.selector, 2));
    }

    function test_OverPerCall_root() public {
        _expectPayRevert(rootPk, payeeA, U / 10 + 1, abi.encodeWithSelector(ILeashWallet.OverPerCall.selector, 1));
    }

    function test_OverPerCall_child() public {
        _child(rootPk, 1, C1, U / 4, U / 20);
        _expectPayRevert(C1, payeeA, U / 20 + 1, abi.encodeWithSelector(ILeashWallet.OverPerCall.selector, 2));
    }

    function test_OverBudget_child() public {
        _child(rootPk, 1, C1, U / 4, U / 10);
        _pay(C1, payeeA, U / 10);
        _pay(C1, payeeA, U / 10);
        _expectPayRevert(C1, payeeA, U / 10, abi.encodeWithSelector(ILeashWallet.OverBudget.selector, 2));
        assertEq(wallet.getNode(2).spent, 2 * U / 10); // failed call charged nothing
        assertEq(wallet.getNode(1).spent, 2 * U / 10);
    }

    function test_sibling_spend_hits_parent_OverBudget() public {
        _child(rootPk, 1, C1, U / 4, U / 10);
        _child(rootPk, 1, C2, U / 4, U / 10);
        vm.prank(owner);
        wallet.raiseCap(1, 3 * U / 10); // root cap 0.30
        _pay(C1, payeeA, U / 10);
        _pay(C1, payeeA, U / 10);
        _pay(C2, payeeA, U / 10); // root now 0.30/0.30, child2 0.10/0.25
        _expectPayRevert(C2, payeeA, U / 20, abi.encodeWithSelector(ILeashWallet.OverBudget.selector, 1));
    }

    function test_raiseCap_unblocks_OverBudget_node() public {
        _child(rootPk, 1, C1, U / 4, U / 10);
        _pay(C1, payeeA, U / 10);
        _pay(C1, payeeA, U / 10);
        _expectPayRevert(C1, payeeA, U / 10, abi.encodeWithSelector(ILeashWallet.OverBudget.selector, 2));
        vm.expectEmit(true, false, false, true, address(wallet));
        emit ILeashWallet.CapRaised(2, U / 4, 4 * U / 10);
        vm.prank(owner);
        wallet.raiseCap(2, 4 * U / 10);
        _pay(C1, payeeA, U / 10);
        assertEq(wallet.getNode(2).spent, 3 * U / 10);
    }

    function test_Expired_root() public {
        vm.warp(rootExpiry); // block.timestamp >= expiry
        _expectPayRevert(rootPk, payeeA, 1, abi.encodeWithSelector(ILeashWallet.Expired.selector, 1));
    }

    function test_Expired_child() public {
        _createChild(rootPk, _params(1, vm.addr(C1), U / 4, U / 10, block.timestamp + 1 hours));
        vm.warp(block.timestamp + 1 hours);
        _expectPayRevert(C1, payeeA, 1, abi.encodeWithSelector(ILeashWallet.Expired.selector, 2));
        _pay(rootPk, payeeA, 1); // root still alive
    }

    function test_Paused_by_owner_blocks_subtree_then_unpause() public {
        _child(rootPk, 1, C1, U / 4, U / 10);
        vm.expectEmit(true, false, false, true, address(wallet));
        emit ILeashWallet.NodePaused(1, owner);
        vm.prank(owner);
        wallet.pause(1);
        _expectPayRevert(rootPk, payeeA, 1, abi.encodeWithSelector(ILeashWallet.Paused.selector, 1));
        _expectPayRevert(C1, payeeA, 1, abi.encodeWithSelector(ILeashWallet.Paused.selector, 1));
        vm.expectEmit(true, false, false, false, address(wallet));
        emit ILeashWallet.NodeUnpaused(1);
        vm.prank(owner);
        wallet.unpause(1);
        _pay(C1, payeeA, 1);
    }

    function test_BelowFloor() public {
        vm.prank(owner);
        wallet.setFloor(5 * U);
        assertEq(wallet.floor(), 5 * U);
        _expectPayRevert(rootPk, payeeA, 1, abi.encodeWithSelector(ILeashWallet.BelowFloor.selector));
        vm.prank(owner);
        wallet.setFloor(5 * U - 1);
        _pay(rootPk, payeeA, 1);
    }

    function test_settle_replay_reverts() public {
        Auth memory a = _auth(rootPk, payeeA, U / 100);
        _settle(a);
        vm.expectRevert(MockAUSD.AuthorizationAlreadyUsed.selector);
        _settle(a);
        assertEq(wallet.getNode(1).spent, U / 100);
    }

    function test_direct_to_token_bypass_reverts() public {
        Auth memory a = _auth(rootPk, payeeA, U / 100);
        vm.prank(attacker);
        vm.expectRevert(MockAUSD.InvalidSignature.selector);
        ausd.transferWithAuthorization(address(wallet), a.to, a.value, a.validAfter, a.validBefore, a.nonce, a.sig);
        _settle(a); // same sig works through Leash
        assertEq(ausd.balanceOf(payeeA), U / 100);
    }

    function test_malformed_signature_reverts() public {
        Auth memory a = _auth(rootPk, payeeA, U / 100);
        a.sig = hex"1234";
        vm.expectRevert();
        _settle(a);
    }

    // ============================================================ isValidSignature

    function test_isValidSignature_outside_settle() public {
        Auth memory a = _auth(rootPk, payeeA, U / 100);
        bytes32 d = _twaDigest(address(wallet), a);
        vm.prank(address(ausd));
        assertEq(wallet.isValidSignature(d, a.sig), bytes4(0xffffffff));
        _settle(a);
        vm.prank(address(ausd));
        assertEq(wallet.isValidSignature(d, a.sig), bytes4(0xffffffff)); // flag cleared
    }

    function test_isValidSignature_wrong_sender() public {
        Auth memory a = _auth(rootPk, payeeA, U / 100);
        bytes32 d = _twaDigest(address(wallet), a);
        vm.prank(attacker);
        assertEq(wallet.isValidSignature(d, a.sig), bytes4(0xffffffff));
        assertEq(wallet.isValidSignature(d, a.sig), bytes4(0xffffffff));
    }

    /// Inside settle: the flag is visible only to AUSD and only for the exact digest.
    function test_isValidSignature_inside_settle_scoped_to_ausd_and_digest() public {
        ProbeToken probe = new ProbeToken();
        LeashWallet w = new LeashWallet(address(probe), owner);
        vm.startPrank(owner);
        w.setAllow(payeeA, true);
        w.createRoot(rootKey, U, U / 10, rootExpiry);
        vm.stopPrank();

        uint256 va = block.timestamp - 5;
        uint256 vb = block.timestamp + 120;
        bytes32 nonce = keccak256("probe");
        bytes32 sh = keccak256(abi.encode(TWA_TYPEHASH, address(w), payeeA, uint256(1), va, vb, nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", probe.DOMAIN_SEPARATOR(), sh));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(rootPk, digest);
        w.settle(payeeA, 1, va, vb, nonce, abi.encodePacked(r, s, v));

        assertEq(probe.rightDigest(), bytes4(0x1626ba7e));
        assertEq(probe.wrongDigest(), bytes4(0xffffffff));
        assertEq(probe.thirdParty(), bytes4(0xffffffff));
        vm.prank(address(probe));
        assertEq(w.isValidSignature(digest, ""), bytes4(0xffffffff)); // cleared after settle
    }

    // ============================================================ delegation errors

    function test_TooDeep() public {
        _child(rootPk, 1, C1, U / 4, U / 10);
        _child(C1, 2, G1, U / 10, U / 20);
        ILeashWallet.ChildParams memory c = _params(3, vm.addr(0x99), U / 100, U / 100, rootExpiry);
        bytes memory sig = _signChild(G1, c);
        vm.expectRevert(ILeashWallet.TooDeep.selector);
        wallet.createChild(c, sig);
    }

    function test_ChildExceedsParent_cap() public {
        ILeashWallet.ChildParams memory c = _params(1, vm.addr(C1), U + 1, U / 10, rootExpiry);
        bytes memory sig = _signChild(rootPk, c);
        vm.expectRevert(ILeashWallet.ChildExceedsParent.selector);
        wallet.createChild(c, sig);
    }

    function test_ChildExceedsParent_maxPerCall() public {
        ILeashWallet.ChildParams memory c = _params(1, vm.addr(C1), U / 4, U / 10 + 1, rootExpiry);
        bytes memory sig = _signChild(rootPk, c);
        vm.expectRevert(ILeashWallet.ChildExceedsParent.selector);
        wallet.createChild(c, sig);
    }

    function test_ChildExceedsParent_expiry() public {
        ILeashWallet.ChildParams memory c = _params(1, vm.addr(C1), U / 4, U / 10, rootExpiry + 1);
        bytes memory sig = _signChild(rootPk, c);
        vm.expectRevert(ILeashWallet.ChildExceedsParent.selector);
        wallet.createChild(c, sig);
    }

    function test_ChildExceedsParent_restricted_parent_payee_subset() public {
        ILeashWallet.ChildParams memory c = _params(1, vm.addr(C1), U / 4, U / 10, rootExpiry);
        c.restricted = true;
        c.payees = new address[](1);
        c.payees[0] = payeeA;
        _createChild(rootPk, c);

        ILeashWallet.ChildParams memory g = _params(2, vm.addr(G1), U / 10, U / 20, rootExpiry);
        g.restricted = true;
        g.payees = new address[](2);
        g.payees[0] = payeeA;
        g.payees[1] = payeeB; // parent does not allow payeeB
        bytes memory sig = _signChild(C1, g);
        vm.expectRevert(ILeashWallet.ChildExceedsParent.selector);
        wallet.createChild(g, sig);

        // subset is fine
        g.payees = new address[](1);
        g.payees[0] = payeeA;
        _createChild(C1, g);
        _pay(G1, payeeA, U / 100);
    }

    function test_BadDelegation_replay() public {
        ILeashWallet.ChildParams memory c = _params(1, vm.addr(C1), U / 4, U / 10, rootExpiry);
        bytes memory sig = _signChild(rootPk, c);
        wallet.createChild(c, sig);
        assertTrue(wallet.usedDelegation(_childStructHash(c)));
        vm.expectRevert(ILeashWallet.BadDelegation.selector);
        wallet.createChild(c, sig);
    }

    function test_BadDelegation_expired_deadline() public {
        ILeashWallet.ChildParams memory c = _params(1, vm.addr(C1), U / 4, U / 10, rootExpiry);
        bytes memory sig = _signChild(rootPk, c);
        vm.warp(c.deadline + 1);
        vm.expectRevert(ILeashWallet.BadDelegation.selector);
        wallet.createChild(c, sig);
    }

    function test_BadDelegation_wrong_signer() public {
        _child(rootPk, 1, C1, U / 4, U / 10);
        // sibling-level key (child 2) signs a delegation claiming parent = root
        ILeashWallet.ChildParams memory c = _params(1, vm.addr(C2), U / 4, U / 10, rootExpiry);
        bytes memory sig = _signChild(C1, c);
        vm.expectRevert(ILeashWallet.BadDelegation.selector);
        wallet.createChild(c, sig);
    }

    function test_BadDelegation_tampered_params() public {
        ILeashWallet.ChildParams memory c = _params(1, vm.addr(C1), U / 4, U / 10, rootExpiry);
        bytes memory sig = _signChild(rootPk, c);
        c.cap = U / 2; // relayer bumps the cap
        vm.expectRevert(ILeashWallet.BadDelegation.selector);
        wallet.createChild(c, sig);
    }

    function test_BadDelegation_unknown_parent() public {
        ILeashWallet.ChildParams memory c = _params(7, vm.addr(C1), U / 4, U / 10, rootExpiry);
        bytes memory sig = _signChild(rootPk, c);
        vm.expectRevert(ILeashWallet.BadDelegation.selector);
        wallet.createChild(c, sig);
    }

    function test_createChild_paused_parent_reverts() public {
        vm.prank(owner);
        wallet.pause(1);
        ILeashWallet.ChildParams memory c = _params(1, vm.addr(C1), U / 4, U / 10, rootExpiry);
        bytes memory sig = _signChild(rootPk, c);
        vm.expectRevert(abi.encodeWithSelector(ILeashWallet.Paused.selector, 1));
        wallet.createChild(c, sig);
    }

    function test_KeyInUse_child_reuse() public {
        _child(rootPk, 1, C1, U / 4, U / 10);
        ILeashWallet.ChildParams memory c = _params(1, vm.addr(C1), U / 4, U / 10, rootExpiry);
        bytes memory sig = _signChild(rootPk, c);
        vm.expectRevert(ILeashWallet.KeyInUse.selector);
        wallet.createChild(c, sig);
    }

    function test_KeyInUse_child_bad_keys() public {
        address[4] memory bad = [address(0), owner, address(wallet), rootKey];
        for (uint256 i; i < bad.length; ++i) {
            ILeashWallet.ChildParams memory c = _params(1, bad[i], U / 4, U / 10, rootExpiry);
            bytes memory sig = _signChild(rootPk, c);
            vm.expectRevert(ILeashWallet.KeyInUse.selector);
            wallet.createChild(c, sig);
        }
    }

    function test_KeyInUse_createRoot() public {
        address[4] memory bad = [address(0), owner, address(wallet), rootKey];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(owner);
            vm.expectRevert(ILeashWallet.KeyInUse.selector);
            wallet.createRoot(bad[i], U, U / 10, rootExpiry);
        }
    }

    // ============================================================ pauseChild

    function test_pauseChild_by_strict_ancestor_blocks_subtree() public {
        _child(rootPk, 1, C1, U / 4, U / 10);
        _child(C1, 2, G1, U / 10, U / 20);
        uint256 deadline = block.timestamp + 60;
        bytes memory sig = _pauseSig(rootPk, 2, 1, deadline);
        vm.expectEmit(true, false, false, true, address(wallet));
        emit ILeashWallet.NodePaused(2, rootKey);
        wallet.pauseChild(2, 1, deadline, sig);
        assertTrue(wallet.getNode(2).paused);
        _expectPayRevert(C1, payeeA, 1, abi.encodeWithSelector(ILeashWallet.Paused.selector, 2));
        _expectPayRevert(G1, payeeA, 1, abi.encodeWithSelector(ILeashWallet.Paused.selector, 2));
        _pay(rootPk, payeeA, 1); // root unaffected

        // replay
        vm.expectRevert(ILeashWallet.BadDelegation.selector);
        wallet.pauseChild(2, 1, deadline, sig);
    }

    function test_pauseChild_by_grandparent() public {
        _child(rootPk, 1, C1, U / 4, U / 10);
        _child(C1, 2, G1, U / 10, U / 20);
        uint256 deadline = block.timestamp + 60;
        wallet.pauseChild(3, 5, deadline, _pauseSig(rootPk, 3, 5, deadline));
        _expectPayRevert(G1, payeeA, 1, abi.encodeWithSelector(ILeashWallet.Paused.selector, 3));
        _pay(C1, payeeA, 1);
    }

    function test_NotAncestor_sibling() public {
        _child(rootPk, 1, C1, U / 4, U / 10);
        _child(rootPk, 1, C2, U / 4, U / 10);
        uint256 deadline = block.timestamp + 60;
        bytes memory sig = _pauseSig(C2, 2, 1, deadline);
        vm.expectRevert(ILeashWallet.NotAncestor.selector);
        wallet.pauseChild(2, 1, deadline, sig);
    }

    function test_NotAncestor_child_pausing_parent_and_self() public {
        _child(rootPk, 1, C1, U / 4, U / 10);
        uint256 deadline = block.timestamp + 60;
        bytes memory up = _pauseSig(C1, 1, 1, deadline);
        vm.expectRevert(ILeashWallet.NotAncestor.selector);
        wallet.pauseChild(1, 1, deadline, up);
        bytes memory self_ = _pauseSig(C1, 2, 2, deadline);
        vm.expectRevert(ILeashWallet.NotAncestor.selector);
        wallet.pauseChild(2, 2, deadline, self_);
    }

    function test_NotAncestor_unknown_signer_and_target() public {
        _child(rootPk, 1, C1, U / 4, U / 10);
        uint256 deadline = block.timestamp + 60;
        bytes memory sig = _pauseSig(0xBAD, 2, 1, deadline);
        vm.expectRevert(ILeashWallet.NotAncestor.selector);
        wallet.pauseChild(2, 1, deadline, sig);
        sig = _pauseSig(rootPk, 42, 1, deadline);
        vm.expectRevert(ILeashWallet.NotAncestor.selector);
        wallet.pauseChild(42, 1, deadline, sig);
    }

    function test_pauseChild_expired_deadline() public {
        _child(rootPk, 1, C1, U / 4, U / 10);
        uint256 deadline = block.timestamp + 60;
        bytes memory sig = _pauseSig(rootPk, 2, 1, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(ILeashWallet.BadDelegation.selector);
        wallet.pauseChild(2, 1, deadline, sig);
    }

    // ============================================================ owner-only

    function test_NotOwner_all_owner_functions() public {
        vm.startPrank(attacker);
        vm.expectRevert(ILeashWallet.NotOwner.selector);
        wallet.createRoot(attacker, U, U, rootExpiry);
        vm.expectRevert(ILeashWallet.NotOwner.selector);
        wallet.pause(1);
        vm.expectRevert(ILeashWallet.NotOwner.selector);
        wallet.unpause(1);
        vm.expectRevert(ILeashWallet.NotOwner.selector);
        wallet.raiseCap(1, 10 * U);
        vm.expectRevert(ILeashWallet.NotOwner.selector);
        wallet.setAllow(attacker, true);
        vm.expectRevert(ILeashWallet.NotOwner.selector);
        wallet.setFloor(0);
        vm.expectRevert(ILeashWallet.NotOwner.selector);
        wallet.withdraw(attacker, 1);
        vm.stopPrank();
        // a node key is not the owner either
        vm.prank(rootKey);
        vm.expectRevert(ILeashWallet.NotOwner.selector);
        wallet.unpause(1);
    }

    function test_owner_setAllow_event_and_withdraw() public {
        vm.expectEmit(true, false, false, true, address(wallet));
        emit ILeashWallet.AllowSet(payeeA, false);
        vm.prank(owner);
        wallet.setAllow(payeeA, false);
        assertFalse(wallet.allowlist(payeeA));
        _expectPayRevert(rootPk, payeeA, 1, abi.encodeWithSelector(ILeashWallet.PayeeNotAllowed.selector, 0));

        vm.prank(owner);
        wallet.withdraw(owner, 2 * U);
        assertEq(ausd.balanceOf(owner), 2 * U);
        assertEq(ausd.balanceOf(address(wallet)), 3 * U);
    }

    function test_owner_ops_unknown_node_revert() public {
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(ILeashWallet.UnknownAgent.selector, address(0)));
        wallet.pause(9);
        vm.expectRevert(abi.encodeWithSelector(ILeashWallet.UnknownAgent.selector, address(0)));
        wallet.raiseCap(0, U);
        vm.stopPrank();
    }
}

/// Stand-in token that probes the wallet's 1271 answers during settle().
contract ProbeToken {
    bytes4 public rightDigest;
    bytes4 public wrongDigest;
    bytes4 public thirdParty;
    Caller immutable caller = new Caller();

    function DOMAIN_SEPARATOR() external pure returns (bytes32) {
        return keccak256("probe-domain");
    }

    function balanceOf(address) external pure returns (uint256) {
        return type(uint128).max;
    }

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata sig
    ) external {
        bytes32 sh = keccak256(
            abi.encode(
                0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267,
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );
        bytes32 d = keccak256(abi.encodePacked("\x19\x01", keccak256("probe-domain"), sh));
        rightDigest = LeashWallet(from).isValidSignature(d, sig);
        wrongDigest = LeashWallet(from).isValidSignature(keccak256(abi.encode(d)), sig);
        thirdParty = caller.ask(from, d);
    }
}

contract Caller {
    function ask(address w, bytes32 d) external view returns (bytes4) {
        return LeashWallet(w).isValidSignature(d, "");
    }
}
