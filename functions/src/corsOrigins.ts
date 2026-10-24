interface ProjectEnvironment {
  GCLOUD_PROJECT?: string;
  FIREBASE_CONFIG?: string;
}

export function stagingOrigins(env: ProjectEnvironment = {
  GCLOUD_PROJECT: process.env.GCLOUD_PROJECT,
  FIREBASE_CONFIG: process.env.FIREBASE_CONFIG,
}): Array<string | RegExp> {
  let projectId = env.GCLOUD_PROJECT;
  if (!projectId && env.FIREBASE_CONFIG) {
    try {
      projectId = (JSON.parse(env.FIREBASE_CONFIG) as { projectId?: string } | null)?.projectId;
    } catch {
      // Missing or invalid project configuration must not widen CORS access.
      return [];
    }
  }
  return projectId === "pixtaffy-staging"
    ? [
      "https://pixtaffy-staging.web.app",
      "https://pixtaffy-staging.firebaseapp.com",
      /^https:\/\/pixtaffy-staging--[a-z0-9-]+\.web\.app$/,
    ]
    : [];
}
