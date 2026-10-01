# Transaction Monitoring Standard (v2)

Synthetic standard for hackathon use only.

## §1.1 Scope
This Standard defines minimum transaction monitoring requirements for all payment products. Monitoring coverage must be confirmed before any new payment product or geography is enabled.

## §3.1 Coverage Requirement
Every new transaction type, channel and destination country must be mapped to at least one active monitoring scenario before launch. Products with partial or unconfirmed coverage may not launch without an approved compensating control and a committee condition.

## §4.2 Velocity and Value Thresholds
Monitoring scenarios must include velocity rules (count per customer per 24 hours) and value rules (single and aggregate daily value). Instant payment products require real-time or near-real-time velocity controls because post-settlement review cannot prevent loss.

## §7.1 Cross-Border Monitoring
Cross-border payments require real-time monitoring for cross-border activity to higher-risk jurisdictions, including destination-country risk scoring, structuring detection below reporting thresholds and rapid movement of funds through newly onboarded accounts.

## §7.3 SMB Payment Products
SMB payment products must include scenarios for round-amount transfers, sudden volume increases inconsistent with declared business activity and payments to counterparties in jurisdictions outside the declared operating footprint.

## §9.1 Tuning and Review
New scenarios must be tuned within 90 days of launch and reviewed monthly for the first six months. Alert volumes and false positive rates must be reported to the Risk Committee.
