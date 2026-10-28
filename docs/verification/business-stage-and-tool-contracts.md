# Business stages and tool contracts

The current agent runtime exposes catalog and journey behavior through typed backend services rather than giving the model direct side effects. Read-only retrieval and conversation context are separated from consented action proposals. Action completion requires correlated execution and callback data.

Missing contracts for the requested full lifecycle are explicit: Salesforce Lead conversion requirements, Account/Contact/Opportunity reconciliation, approved package/price book, invoice/payment provider, contract template/provider, and signing completion criteria. These cannot be invented from the current repository.
