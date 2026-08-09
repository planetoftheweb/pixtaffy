import * as admin from "firebase-admin";

admin.initializeApp();

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
  cleanupPaidDeliveries,
  generateGuestImage,
  generateWithCredits,
  getPaidAiCatalog,
  refreshOpenRouterModelCatalog,
  runAiAssist,
} from "./paidAi";
export { enforceHistoryRetention } from "./historyRetention";
