# Leash kit: 3 steps, then Claude Code builds everything

Everything else is done: CLAUDE.md, 7 subagents, permissions, .gitignore, generated testnet keys, and the master prompt.

## 1. Fund the deployer (do this first, it can take a few minutes)
Send Base Sepolia ETH (0.05 is plenty) to:

    0xd6B7A3469b12be5E93c244a36f73deE7f31fdFdc

Faucet: https://portal.cdp.coinbase.com/products/faucet (Base Sepolia, ETH). Backups: Alchemy or QuickNode Base Sepolia faucets.

## 2. Paste two keys into `env.txt` (becomes `.env`)
- `ANTHROPIC_API_KEY` (console.anthropic.com)
- `CONTEXT_DEV_API_KEY` (context.dev, sign up with your berkeley.edu email for more free credits)
- Optional: `ELEVENLABS_API_KEY` (Discord coupon from the hackathon page), `BASE_SEPOLIA_RPC_URL` (Alchemy/QuickNode, faster than the public one)


## 3. Launch
Your Mac blocks remote writes to `.env` and `.claude`, so they arrived as `env.txt` and `_claude`. Fill the keys in `env.txt` (step 2), then run this one line in Terminal:

    cd ~/Desktop/leash && mv _claude .claude && mv env.txt .env && claude --dangerously-skip-permissions --model opus --effort high

If `--effort` errors, launch without it and type `/effort high`. Then paste everything in `START_PROMPT.md`.

## Plan (model and effort per phase)
| Time | Phase | Who | Model / effort |
|---|---|---|---|
| 2:15-2:35 | P0 gate on real AUSD + all scaffolds in parallel | lead, solidity-engineer, facilitator-, frontend-, agent-engineer | Opus high; Opus high; Sonnet high / medium / high |
| 2:35-3:10 | P1 contract + tests, services wired | same | same |
| 3:10 | Council gate 1 | protocol-auditor | Opus xhigh |
| 3:10-3:35 | P2 deploy, verify, first real paid call | lead, solidity, facilitator | Opus high, Sonnet high |
| 3:35-4:00 | P3 agents + dashboard, all demo beats | agent-, frontend-engineer | Sonnet high / medium |
| 4:00 | Freeze review, README, shot list | demo-director, docs-writer | Sonnet high, Haiku low |
| 4:00-4:30 | You record the video | you | |
| 4:30-4:45 | Repo public, submit | you | |

Ultracode stays off: its orchestration overhead doesn't fit a 3-hour build.

## While it builds
- If the AUSD faucet is empty, ask the Agora table (Allen) for ~20 testnet AUSD to `0xd6B7A3469b12be5E93c244a36f73deE7f31fdFdc`.
- Confirm on hackathoncompany.com/platform which tracks you can tick: Most Technically Impressive, AUSD, YZi Labs, Context.dev, ElevenLabs (if the step-up ships).
