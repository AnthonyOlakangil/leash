// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {LeashWallet} from "../../src/LeashWallet.sol";
import {ILeashWallet} from "../../src/ILeashWallet.sol";

interface IAUSDFull {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function balanceOf(address) external view returns (uint256);
    function decimals() external view returns (uint8);
    function transfer(address, uint256) external returns (bool);
    function authorizationState(address, bytes32) external view returns (bool);
    function eip712Domain()
        external
        view
        returns (bytes1, string memory, string memory, uint256, address, bytes32, uint256[] memory);
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

/// P0 gate against REAL AUSD on Base Sepolia.
/// Run: forge test --fork-url $BASE_SEPOLIA_RPC_URL --match-path "test/fork/*" -vvv --gas-report
contract AusdGateTest is Test {
    address constant AUSD = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;
    address constant DEPLOYER = 0xd6B7A3469b12be5E93c244a36f73deE7f31fdFdc;
    bytes4 constant INVALID_SIGNATURE = bytes4(keccak256("InvalidSignature()")); // AUSD's revert on 1271 rejection
    bytes32 constant TWA_TYPEHASH = 0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267;

    IAUSDFull ausd = IAUSDFull(AUSD);
    LeashWallet wallet;
    uint256 rootPk;
    address rootKey;
    address payee;
    uint256 unit;

    function setUp() public {
        if (block.chainid != 84532) {
            vm.skip(true);
            return;
        }
        unit = 10 ** ausd.decimals();
        rootPk = uint256(keccak256("leash.fork.root"));
        rootKey = vm.addr(rootPk);
        payee = makeAddr("payeeSearch");

        wallet = new LeashWallet(AUSD, DEPLOYER);

        // Fund wallet: transfer from DEPLOYER (holds AUSD live), deal as fallback.
        vm.prank(DEPLOYER);
        try ausd.transfer(address(wallet), 5 * unit) {}
        catch {
            deal(AUSD, address(wallet), 5 * unit);
        }
        assertEq(ausd.balanceOf(address(wallet)), 5 * unit, "funding failed");

        vm.startPrank(DEPLOYER);
        wallet.setAllow(payee, true);
        wallet.createRoot(rootKey, 1 * unit, unit / 10, block.timestamp + 1 days);
        vm.stopPrank();
    }

    function _auth(uint256 value, bytes32 nonce)
        internal
        view
        returns (uint256 validAfter, uint256 validBefore, bytes memory sig)
    {
        validAfter = block.timestamp - 5;
        validBefore = block.timestamp + 120;
        bytes32 structHash =
            keccak256(abi.encode(TWA_TYPEHASH, address(wallet), payee, value, validAfter, validBefore, nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", ausd.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(rootPk, digest);
        sig = abi.encodePacked(r, s, v);
    }

    function test_gate_domain() public view {
        (, string memory name, string memory version, uint256 chainId, address vc,,) = ausd.eip712Domain();
        assertEq(name, "Agora Dollar");
        assertEq(version, "1");
        assertEq(chainId, 84532);
        assertEq(vc, AUSD);
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Agora Dollar"),
                keccak256("1"),
                uint256(84532),
                AUSD
            )
        );
        assertEq(ausd.DOMAIN_SEPARATOR(), expected);
        console2.log("decimals", ausd.decimals());
    }

    /// Settle succeeds and moves balances; spent increments; flag cleared afterwards.
    function test_gate_settle_moves_balance() public {
        uint256 value = 2 * unit / 100; // 0.02
        bytes32 nonce = keccak256("nonce-1");
        (uint256 va, uint256 vb, bytes memory sig) = _auth(value, nonce);

        uint256 wBefore = ausd.balanceOf(address(wallet));
        uint256 pBefore = ausd.balanceOf(payee);

        vm.expectEmit(true, true, false, true, address(wallet));
        emit ILeashWallet.Paid(1, payee, value, nonce);
        uint256 g = gasleft();
        wallet.settle(payee, value, va, vb, nonce, sig);
        console2.log("settle gas (approx, in-test)", g - gasleft());

        assertEq(ausd.balanceOf(address(wallet)), wBefore - value);
        assertEq(ausd.balanceOf(payee), pBefore + value);
        assertEq(wallet.getNode(1).spent, value);
        assertTrue(ausd.authorizationState(address(wallet), nonce));
    }

    /// The SAME signature sent directly to AUSD reverts (no transient flag), yet settles through Leash.
    function test_gate_direct_bypass_reverts() public {
        uint256 value = 2 * unit / 100;
        bytes32 nonce = keccak256("nonce-bypass");
        (uint256 va, uint256 vb, bytes memory sig) = _auth(value, nonce);

        vm.prank(makeAddr("attacker"));
        vm.expectRevert(INVALID_SIGNATURE);
        ausd.transferWithAuthorization(address(wallet), payee, value, va, vb, nonce, sig);
        assertEq(ausd.balanceOf(payee), 0);
        assertFalse(ausd.authorizationState(address(wallet), nonce));

        // Same signature is genuinely valid through settle().
        wallet.settle(payee, value, va, vb, nonce, sig);
        assertEq(ausd.balanceOf(payee), value);

        // And cannot be pushed direct afterwards either.
        vm.expectRevert();
        ausd.transferWithAuthorization(address(wallet), payee, value, va, vb, nonce, sig);
    }

    /// Replay of settle reverts and does not double-charge.
    function test_gate_replay_reverts() public {
        uint256 value = 2 * unit / 100;
        bytes32 nonce = keccak256("nonce-replay");
        (uint256 va, uint256 vb, bytes memory sig) = _auth(value, nonce);

        wallet.settle(payee, value, va, vb, nonce, sig);
        vm.expectRevert();
        wallet.settle(payee, value, va, vb, nonce, sig);
        assertEq(wallet.getNode(1).spent, value);
        assertEq(ausd.balanceOf(payee), value);
    }

    /// isValidSignature is closed outside settle, for AUSD and for any other caller.
    function test_gate_isValidSignature_outside_settle() public {
        uint256 value = 2 * unit / 100;
        bytes32 nonce = keccak256("nonce-1271");
        (uint256 va, uint256 vb, bytes memory sig) = _auth(value, nonce);
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                ausd.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(TWA_TYPEHASH, address(wallet), payee, value, va, vb, nonce))
            )
        );

        vm.prank(AUSD);
        assertEq(wallet.isValidSignature(digest, sig), bytes4(0xffffffff));
        assertEq(wallet.isValidSignature(digest, sig), bytes4(0xffffffff));

        wallet.settle(payee, value, va, vb, nonce, sig);

        // flag cleared after settle
        vm.prank(AUSD);
        assertEq(wallet.isValidSignature(digest, sig), bytes4(0xffffffff));
    }
}
