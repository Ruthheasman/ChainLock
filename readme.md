# ChainLock

## A BSV-powered package integrity layer for software supply chains

### The problem

On March 24, 2026, LiteLLM's PyPI release (v1.82.8) was found to contain a malicious `.pth` file — base64-encoded instructions to exfiltrate credentials and self-replicate. The attacker compromised a developer's machine and pushed a poisoned package through the normal publishing pipeline. Every existing check passed. Hashes matched. Signatures were valid. The system worked exactly as designed, and it still failed.

This isn't new. SolarWinds. event-stream. ua-parser-js. codecov. The pattern is always the same: compromise one trusted identity, and the entire downstream supply chain trusts the poison.

The root cause isn't missing cryptography. It's that package registries treat a single developer credential as sufficient proof of legitimacy.

### The insight

What if publishing a package wasn't a single-key operation?

BSV gives us something no other chain can offer at this scale: sub-penny transactions with unbounded data capacity. That makes it economically viable to record every single package release, every attestation, every review, and every build verification on-chain — not just for major releases, but for every point release of every package. Try doing that on Ethereum at $2+ per transaction.

### How ChainLock works

ChainLock sits between your package registry (npm, PyPI, crates.io) and your install command. It doesn't replace existing registries — it adds a trust layer on top.

**1. Multi-sig publishing**

A package release requires m-of-n maintainer signatures before its on-chain record is marked as "blessed." The LiteLLM attacker got one developer's machine. With 2-of-3 multi-sig, that's not enough. The other maintainers would need to independently verify and co-sign.

Each signature is a BSV transaction input, so the multi-sig is enforced at the protocol level — not by a centralised service that could itself be compromised.

**2. Reproducible build attestation**

Independent build nodes pull the tagged source commit, build the package, and publish their resulting hash on-chain. If your build produces a different hash than the others, something was injected between source and package. The `.pth` file in LiteLLM would have failed this check immediately — it existed in the published package but not in the source repository.

Multiple independent builders can participate. The more attestations that agree, the higher the confidence score.

**3. Diff transparency**

Every release includes an on-chain record of what changed from the previous version. Not just "new version available" but a hash of the actual diff. An unexpected new `.pth` file with no corresponding source change would be visible to anyone inspecting the chain.

**4. Challenge window with micropayment bounties**

New releases enter a configurable cool-off period (e.g. 2 hours) before they're considered verified. During this window, automated scanners and community reviewers can flag suspicious releases. Flagging is incentivised with BSV micropayments — lock a small bounty into the release transaction, and the first reviewer to correctly flag a compromised package claims it.

This creates a market for security review. Not a "bug bounty programme" with 90-day response times, but a real-time economic incentive to catch bad releases fast.

**5. Immutable audit trail**

Every package version creates an on-chain record containing:

- Source commit hash (pinned to a specific git SHA)
- Build artifact hash
- All maintainer signatures
- Reproducible build attestations from independent builders
- Diff hash from previous version
- Timestamp (block height)
- Challenge window status and any flags raised

This record is permanent, public, and tamper-proof. When an incident happens, you can trace exactly when the compromised version appeared, who signed it, and whether any reproducible build checks failed.

### What the developer experience looks like

**For package maintainers:**

```
$ chainlock publish my-package@1.2.3
→ Building from source commit a3f8c2d...
→ Package hash: 7b4e9f1...
→ Requesting co-signatures from 2 other maintainers...
→ Alice signed ✓
→ Bob signed ✓
→ Publishing to PyPI + recording on BSV...
→ Challenge window: 2 hours
→ Done. Package will be verified at 14:30 UTC.
```

**For package consumers:**

```
$ npm install some-package    # normal install
$ chainlock verify             # checks all dependencies against on-chain records
→ 142 packages verified ✓
→ 3 packages have no ChainLock record (unprotected)
→ 1 package failed reproducible build check ⚠️
  └── some-sketchy-lib@0.3.1 — build hash mismatch, 1 of 3 builders disagree
```

Or as a CI/CD step:

```yaml
- name: Verify supply chain
  run: chainlock verify --strict --fail-on-mismatch
```

### Why BSV specifically

This only works on BSV. Here's why:

- **Transaction cost.** A busy npm package might publish 50 releases per year. With multi-sig, build attestations, and challenge windows, that's hundreds of transactions per package. Across the npm registry's 2.5 million packages, you need a chain that can handle millions of small transactions cheaply. BSV's fees are fractions of a penny.
- **Data capacity.** On-chain records need to include hashes, signatures, metadata, and potentially diff summaries. BSV's large block capacity means you're not fighting for block space.
- **SPV verification.** Consumers can verify package records without running a full node, using Simplified Payment Verification. This matters for CI/CD environments where you don't want to sync a blockchain just to verify your dependencies.
- **Existing tooling.** The `@bsv/sdk` already handles transaction construction, key management, and SPV. WhatsOnChain provides reliable blockchain data access. The infrastructure exists.

### Revenue model

**Freemium for package maintainers.** Basic multi-sig publishing is free (the transaction fees are negligible). Premium tiers add automated reproducible build infrastructure, priority challenge window review, and SLA-backed verification endpoints.

**Micropayment-funded review market.** Package maintainers lock small BSV bounties into release transactions. Security reviewers earn by participating in challenge windows. ChainLock takes a thin fee on bounty payouts. This is a self-sustaining security economy.

**Enterprise API access.** Companies running ChainLock verification in CI/CD pipelines pay for guaranteed uptime, historical audit access, and compliance reporting. Pay-per-query via BSV micropayments — no subscriptions, no invoicing, just usage-based billing at the protocol level.

### What this doesn't solve (and what does)

ChainLock doesn't prevent a developer's machine from being compromised. Nothing does — that's a local security problem. What it does is ensure that a single compromised machine can't silently poison the supply chain.

It also doesn't solve the "malicious maintainer" problem where a trusted developer intentionally inserts a backdoor. But multi-sig makes that harder (you'd need to compromise or collude with multiple maintainers), and reproducible build checks catch anything injected outside the source repo.

The real win is making supply chain attacks expensive and visible instead of cheap and invisible.

### MVP scope

Phase 1 — proof of concept:

- CLI tool (`chainlock`) for publishing and verifying npm packages
- 2-of-3 multi-sig via BSV transactions using `@bsv/sdk`
- On-chain package records with source commit + build artifact hashes
- Basic `chainlock verify` command that checks installed packages against on-chain records
- WhatsOnChain integration for record lookup and SPV verification
- One reference package (probably one of yours) published with full ChainLock attestation

Phase 2 — reproducible builds + challenge windows:

- Independent build verification nodes
- Challenge window with micropayment bounties
- Diff transparency records
- CI/CD integration (GitHub Actions, Replit deployment hooks)

Phase 3 — ecosystem growth:

- PyPI and crates.io support
- Enterprise API
- Package security scoring based on attestation depth
- Browser extension showing ChainLock status on npm/PyPI package pages

### Who builds this

This is a perfect 3C project or BSV hackathon entry. The MVP is scoped tightly enough for a focused build sprint. The `bsv-micropay-middleware` package you've already built handles the micropayment infrastructure. The SDK work is straightforward.

And honestly? After the LiteLLM incident, the timing is perfect. The developer community is actively looking for answers right now. Showing up with a working prototype that uses BSV to solve a real, painful problem is the kind of thing that changes how people think about the chain.

---

*Concept by Ruth Heasman / Ruth Designs Digital — March 2026*
