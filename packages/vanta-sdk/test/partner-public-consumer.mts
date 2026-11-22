import {openStealthOSPartnerApp, openStealthOSPublicPayment, normalizeVantaFamilyHandle, type StealthOSPartnerConfiguration, type SelectedFamilyWalletProvider} from '@stealthos/vanta-sdk';
import {getCompiledFamilyEvmRelease} from '@stealthos/vanta-sdk/network';
import {normalizePartnerApplication} from '@stealthos/vanta-sdk/setup';
import {createVantaLocalPrivacyWallet} from '@stealthos/vanta-sdk/recovery';

declare const provider: SelectedFamilyWalletProvider;
declare const configuration: StealthOSPartnerConfiguration;
const wallet = await openStealthOSPartnerApp({provider, configuration});
void wallet.quoteDeposit;
void wallet.quotePrivateSend;
void wallet.dispose;
void [openStealthOSPublicPayment, normalizeVantaFamilyHandle, getCompiledFamilyEvmRelease, normalizePartnerApplication, createVantaLocalPrivacyWallet];
