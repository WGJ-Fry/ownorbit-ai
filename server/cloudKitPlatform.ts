export const CLOUDKIT_TEST_PLATFORM_ENV = "LIFEOS_CLOUDKIT_TEST_PLATFORM_SUPPORTED";

type CloudKitPlatformOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
};

export function isCloudKitPlatformSupported(options: CloudKitPlatformOptions = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (platform === "darwin") return true;
  return env.NODE_ENV === "test" && env[CLOUDKIT_TEST_PLATFORM_ENV] === "1";
}
