# Product Proposal: International Instant Payments for SMB Customers

## 1. Summary
We propose to launch International Instant Payments, a new product that lets existing small and medium business (SMB) customers send near-instant cross-border payments. The product launches in Canada and Mexico in the first phase. Payments are initiated through our public API channel and settle within 60 seconds.

## 2. Customer Segment
The product is available to existing SMB customers with an active business operating account. No new customer segment is onboarded in phase one. Customers must have completed standard KYC within the last 24 months.

## 3. Geographies
Phase one covers Canada and Mexico only. Additional corridors will be considered after six months of operation.

## 4. Channel and Technology
Payments are initiated through our public API channel. The API is integrated with the third-party processor PayRail Inc., which performs currency conversion and beneficiary payout. Authentication uses existing OAuth client credentials. No new mobile or branch channel is introduced.

## 5. Transaction Characteristics
Expected average transaction value is USD 4,200 with a per-transaction maximum of USD 25,000. Expected transaction type is instant credit transfer. Transaction volume projections are not yet finalised and will be provided by the payments product team.

## 6. Controls
Existing sanctions screening runs on all outbound payments before release. Transaction monitoring coverage: cross-border instant payments are currently covered by the existing monitoring scenarios for domestic wires; a dedicated cross-border scenario is planned for phase two. Daily velocity limits are enforced by the API gateway.

## 7. Process
Operations will use the existing wire operations team. Exception handling for failed payouts will be a manual process for the first three months.
