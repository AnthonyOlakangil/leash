// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {LeashWallet} from "../src/LeashWallet.sol";

interface IERC20Meta {
    function decimals() external view returns (uint8);
    function transfer(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// Deploy LeashWallet on Base Sepolia, allowlist payees, create the root node, fund the wallet.
/// Env: DEPLOYER_PRIVATE_KEY, DEPLOYER_ADDRESS, AUSD_ADDRESS (default live AUSD), PAYEE_SEARCH_ADDRESS,
///      PAYEE_SCRAPE_ADDRESS, ROOT_AGENT_ADDRESS, optional ROOT_EXPIRY (default 2026-10-11 23:59 PT),
///      optional FUND_AUSD (whole AUSD to transfer from DEPLOYER to the wallet, default 5; 0 to skip).
/// Dry run:  forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL
/// Live:     forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast
contract Deploy is Script {
    address constant AUSD_LIVE = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;
    uint256 constant DEFAULT_EXPIRY = 1791788340; // 2026-10-11 23:59:00 PT

    function run() external returns (LeashWallet wallet) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY"); // never logged
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        require(vm.addr(pk) == deployer, "DEPLOYER_PRIVATE_KEY does not match DEPLOYER_ADDRESS");
        address ausd = vm.envOr("AUSD_ADDRESS", AUSD_LIVE);
        address payeeSearch = vm.envAddress("PAYEE_SEARCH_ADDRESS");
        address payeeScrape = vm.envAddress("PAYEE_SCRAPE_ADDRESS");
        address rootAgent = vm.envAddress("ROOT_AGENT_ADDRESS");
        uint256 expiry = vm.envOr("ROOT_EXPIRY", DEFAULT_EXPIRY);
        uint256 fund = vm.envOr("FUND_AUSD", uint256(5));

        require(block.chainid == 84532, "not Base Sepolia");
        require(expiry > block.timestamp, "expiry in the past");
        uint256 unit = 10 ** IERC20Meta(ausd).decimals();

        vm.startBroadcast(pk);
        wallet = new LeashWallet(ausd, deployer);
        wallet.setAllow(payeeSearch, true);
        wallet.setAllow(payeeScrape, true);
        uint256 rootId = wallet.createRoot(rootAgent, 1 * unit, unit / 10, expiry);
        if (fund > 0) IERC20Meta(ausd).transfer(address(wallet), fund * unit);
        vm.stopBroadcast();

        console2.log("LeashWallet", address(wallet));
        console2.log("root id", rootId);
        console2.log("root key", rootAgent);
        console2.log("wallet AUSD balance", IERC20Meta(ausd).balanceOf(address(wallet)));
    }
}
