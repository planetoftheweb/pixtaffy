import { initializeApp } from "firebase-admin/app";
import * as logger from "firebase-functions/logger";

logger.info("runtime", { node: process.version });
initializeApp();

export { setAdminRole, deleteUserAccount } from "./admin";
export { agentGenerateImage } from "./agentGenerateImage";
export { manageApiTokens } from "./apiTokens";
export {
  createCheckout,
  getBillingState,
  getCreditActivity,
  onStripeCheckoutSession,
  onStripeCustomerWrite,
  onStripePayment,
  onStripeSubscription,
  releaseImageBatchRemainder,
  releaseStaleImageBatches,
  reserveImageBatch,
  stripeBillingEvents,
} from "./billing";
export {
  createPortalLink,
  onStripeUserDeleted,
  stripeWebhook,
} from "./stripeSync";
export {
  cleanupPaidDeliveries,
  generateGuestImage,
  generateWithCredits,
  getGuestCreditState,
  getPaidAiCatalog,
  refreshOpenRouterModelCatalog,
  runAiAssist,
} from "./paidAi";
export { enforceHistoryRetention } from "./historyRetention";
export { submitFeedback } from "./feedback";
