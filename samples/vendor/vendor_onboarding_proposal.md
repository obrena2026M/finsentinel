# Vendor Onboarding Proposal: VerifyCo KYC Screening

## 1. Summary
We propose to replace the in-house identity verification step for business onboarding with VerifyCo Ltd, a third-party KYC screening vendor. VerifyCo will perform document verification, beneficial-owner lookups and sanctions screening through an API integration.

## 2. Customer Segment
All new business customers (SMB and commercial) onboarded in Canada. No new customer segment is introduced.

## 3. Geographies
Canada only. VerifyCo processes and stores data in Canada and the United States.

## 4. Channel and Technology
Onboarding continues through the existing web and branch channels. VerifyCo is integrated through an API. Customer identity documents will be transmitted to VerifyCo for verification.

## 5. Transaction Characteristics
Not applicable; this change affects onboarding, not payments. Expected volume is 3,500 business onboardings per month.

## 6. Controls
Sanctions screening at onboarding will be performed by VerifyCo instead of the in-house screening engine. Monitoring coverage: unchanged; transaction monitoring is unaffected. Beneficial-owner data returned by VerifyCo will feed the customer risk rating.

## 7. Process
The onboarding team will review VerifyCo results in a new dashboard. Escalations for potential sanctions matches will continue to go to the FCRM team.
