// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {LeashWallet} from "../src/LeashWallet.sol";

/// Golden vectors shared with the TypeScript client tests (packages/abi/golden/digest.json).
/// All inputs are fixed; expected digests are hard-coded so any drift in either side is caught.
contract GoldenTest is Test {
    address constant AUSD = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;
    bytes32 constant AUSD_DOMAIN_SEPARATOR = 0x5a85328c8aae02b57a5bc1fb1848cb2fb9ccbdc204c554a4db199b13fed1e8bb;
    uint256 constant CHAIN_ID = 84532;
    address constant WALLET = 0x1111111111111111111111111111111111111111;
    address constant TO = 0x2222222222222222222222222222222222222222;
    address constant PAYEE2 = 0x3333333333333333333333333333333333333333;
    uint256 constant VALUE = 20000;
    uint256 constant VALID_AFTER = 1791700000;
    uint256 constant VALID_BEFORE = 1791700120;

    bytes32 constant TWA_TYPEHASH = 0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267;

    // Expected outputs (computed once, pinned).
    bytes32 constant EXPECTED_TWA_DIGEST = 0x8781ace444fdfc139595e1a7115dc875d25c37433d480586ba4429e8c79e3260;
    bytes32 constant EXPECTED_LEASH_DOMAIN = 0x837a47dbe5d46f4957f65474d4c8b36f49f110a9c4bbfb54b8a7a7e6259a85c8;
    bytes32 constant EXPECTED_CHILD_DIGEST = 0x7e5b54e46fe2bbdfc63038db7cd2879b65e4ebcbc2a75e803aa767be80da0f92;
    bytes32 constant EXPECTED_PAUSE_DIGEST = 0xa73167b4ae993f131ee6ec3079419cd24a5cc4baabd8f9baac108cda7046a62b;

    function _nonce() internal pure returns (bytes32) {
        return keccak256("leash.golden.nonce");
    }

    function _pk() internal pure returns (uint256) {
        return uint256(keccak256("leash.golden.key")); // TEST ONLY, publicly derived
    }

    function _sig(bytes32 d) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(_pk(), d);
        return abi.encodePacked(r, s, v);
    }

    function test_golden_vectors() public {
        // AUSD domain
        bytes32 ausdDomain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Agora Dollar"),
                keccak256("1"),
                CHAIN_ID,
                AUSD
            )
        );
        assertEq(ausdDomain, AUSD_DOMAIN_SEPARATOR, "AUSD domain");

        // TransferWithAuthorization digest (from = wallet)
        bytes32 twaStruct =
            keccak256(abi.encode(TWA_TYPEHASH, WALLET, TO, VALUE, VALID_AFTER, VALID_BEFORE, _nonce()));
        bytes32 twaDigest = keccak256(abi.encodePacked("\x19\x01", ausdDomain, twaStruct));

        // Leash delegation domain, checked against the real contract placed at WALLET on chain 84532.
        vm.chainId(CHAIN_ID);
        LeashWallet impl = new LeashWallet(AUSD, address(0xdead));
        vm.etch(WALLET, address(impl).code);
        bytes32 leashDomain = LeashWallet(WALLET).DELEGATION_DOMAIN_SEPARATOR();
        assertEq(
            leashDomain,
            keccak256(
                abi.encode(
                    keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                    keccak256("Leash"),
                    keccak256("1"),
                    CHAIN_ID,
                    WALLET
                )
            )
        );

        // CreateChild digest
        address childKey = vm.addr(uint256(keccak256("leash.golden.child")));
        address[] memory payees = new address[](2);
        payees[0] = TO;
        payees[1] = PAYEE2;
        bytes32 payeesHash = keccak256(abi.encodePacked(payees));
        bytes32 childStruct = keccak256(
            abi.encode(
                LeashWallet(WALLET).CREATE_CHILD_TYPEHASH(),
                uint256(1),
                childKey,
                uint256(250000),
                uint256(100000),
                uint256(1791788340),
                true,
                payeesHash,
                uint256(7),
                uint256(1791700300)
            )
        );
        bytes32 childDigest = keccak256(abi.encodePacked("\x19\x01", leashDomain, childStruct));

        // PauseChild digest
        bytes32 pauseStruct =
            keccak256(abi.encode(LeashWallet(WALLET).PAUSE_CHILD_TYPEHASH(), uint256(2), uint256(9), uint256(1791700300)));
        bytes32 pauseDigest = keccak256(abi.encodePacked("\x19\x01", leashDomain, pauseStruct));

        _write(twaDigest, leashDomain, childKey, payeesHash, childDigest, pauseDigest);

        assertEq(twaDigest, EXPECTED_TWA_DIGEST, "twa digest");
        assertEq(leashDomain, EXPECTED_LEASH_DOMAIN, "leash domain");
        assertEq(childDigest, EXPECTED_CHILD_DIGEST, "child digest");
        assertEq(pauseDigest, EXPECTED_PAUSE_DIGEST, "pause digest");
    }

    function _write(
        bytes32 twaDigest,
        bytes32 leashDomain,
        address childKey,
        bytes32 payeesHash,
        bytes32 childDigest,
        bytes32 pauseDigest
    ) internal {
        string memory j = string.concat(
            "{\n",
            '  "note": "Golden vectors from contracts/test/Golden.t.sol. testOnlyPrivateKey = keccak256(\\"leash.golden.key\\"), public test key, never fund it. Amounts atomic units (6 decimals).",\n',
            '  "chainId": 84532,\n',
            '  "testOnlyPrivateKey": "', vm.toString(bytes32(_pk())), '",\n',
            '  "signer": "', vm.toString(vm.addr(_pk())), '",\n',
            '  "transferWithAuthorization": {\n',
            '    "ausd": "', vm.toString(AUSD), '",\n',
            '    "domainSeparator": "', vm.toString(AUSD_DOMAIN_SEPARATOR), '",\n',
            '    "from": "', vm.toString(WALLET), '",\n',
            '    "to": "', vm.toString(TO), '",\n'
        );
        j = string.concat(
            j,
            '    "value": "', vm.toString(VALUE), '",\n',
            '    "validAfter": "', vm.toString(VALID_AFTER), '",\n',
            '    "validBefore": "', vm.toString(VALID_BEFORE), '",\n',
            '    "nonce": "', vm.toString(_nonce()), '",\n',
            '    "digest": "', vm.toString(twaDigest), '",\n',
            '    "signature": "', vm.toString(_sig(twaDigest)), '"\n',
            "  },\n"
        );
        j = string.concat(
            j,
            '  "createChild": {\n',
            '    "wallet": "', vm.toString(WALLET), '",\n',
            '    "domainSeparator": "', vm.toString(leashDomain), '",\n',
            '    "parentId": "1",\n',
            '    "key": "', vm.toString(childKey), '",\n',
            '    "cap": "250000", "maxPerCall": "100000", "expiry": "1791788340", "restricted": true,\n',
            '    "payees": ["', vm.toString(TO), '", "', vm.toString(PAYEE2), '"],\n',
            '    "payeesHash": "', vm.toString(payeesHash), '",\n',
            '    "nonce": "7", "deadline": "1791700300",\n'
        );
        j = string.concat(
            j,
            '    "digest": "', vm.toString(childDigest), '",\n',
            '    "signature": "', vm.toString(_sig(childDigest)), '"\n',
            "  },\n",
            '  "pauseChild": {\n',
            '    "wallet": "', vm.toString(WALLET), '",\n',
            '    "target": "2", "nonce": "9", "deadline": "1791700300",\n',
            '    "digest": "', vm.toString(pauseDigest), '",\n',
            '    "signature": "', vm.toString(_sig(pauseDigest)), '"\n',
            "  }\n}\n"
        );
        vm.createDir("../packages/abi/golden", true);
        vm.writeFile("../packages/abi/golden/digest.json", j);
    }
}
