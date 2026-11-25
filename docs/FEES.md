# Fees and amount handling

All monetary inputs are unsigned integer strings in atomic asset units. Obtain decimals from authenticated asset/context metadata. Do not use JS Number for balances, fees or conversions. Example: 1.25 in a six-decimal asset is 1250000 atomic units. Validate precision before conversion and format with exact integer arithmetic.

| Quote | Fields to render |
| --- | --- |
| Deposit / payment | amountAtomic, protocolFeeAtomic (0 in this type), partnerFeeAtomic, netAmountAtomic, deadline; connected wallet's network fee is separate |
| Private transfer | amountAtomic, protocolFeeAtomic, partnerFeeAtomic, gasReserveAtomic, totalDebitAtomic, deadline |
| Withdrawal / enhanced | netPayoutAtomic, protocolFeeAtomic, partnerFeeAtomic, gasReserveAtomic, totalDebitAtomic, expiresAt, destination, enhanced windowSeconds |
| Public batch | grossAmountAtomic, netPayoutAtomic, per-payment recipients/amounts, protocolFeeAtomic, partnerFeeAtomic, gasReserveAtomic, totalDebitAtomic, expiresAt |
| Swap/bridge | same operation fee fields plus venue output decimals, minimumOutputAtomic, maximumDeliveryFeeAtomic and receiver; distinguish input and output units |

Use returned signed/current policy, not a fixed global fee rate or an assumed minimum. Partner updates are registry-controlled and may invalidate quotes. Relayed operations include their reviewed gas reserve where applicable. previewNetworkGas is an estimate, not a fee commitment or replacement for a quote. Show user what they pay and what the recipient receives. If terms change or expiry is reached, obtain a new quote and explicit consent. Never collect a second fee through the integration UI without separate, disclosed policy.
