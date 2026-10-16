import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostCredentialSource, resolveDeploymentModel } from "./deployment-model.js";

// Host credentials come from the process, so blank the ones a developer machine or CI
// host may carry; each case states its own.
const HOST_CREDENTIAL_ENV = [
  "AWS_PROFILE",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
];

describe("resolveDeploymentModel", () => {
  beforeEach(() => {
    for (const name of HOST_CREDENTIAL_ENV) vi.stubEnv(name, "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("pairs the deployment model key with the provider it belongs to", () => {
    const both = { OPENROUTER_API_KEY: "or-key", ANTHROPIC_API_KEY: "sk-ant-key" };
    expect(resolveDeploymentModel(both)).toEqual({
      provider: "openrouter",
      model: "openai/gpt-6-luna",
      key: "or-key",
      configured: true,
      hostCredentials: false,
    });
    // The whole point: switching the provider switches the key with it.
    expect(resolveDeploymentModel({ ...both, PI_DEFAULT_PROVIDER: "anthropic" })).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5",
      key: "sk-ant-key",
      configured: true,
      hostCredentials: false,
    });
    // A provider with no key configured yields no key — never another vendor's.
    expect(
      resolveDeploymentModel({ OPENROUTER_API_KEY: "or-key", PI_DEFAULT_PROVIDER: "anthropic" }),
    ).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5",
      key: undefined,
      configured: false,
      hostCredentials: false,
    });
  });

  it("runs a provider that authenticates from the host without a key", () => {
    vi.stubEnv("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "/v2/credentials/example");
    const taskRole = {
      PI_DEFAULT_PROVIDER: "amazon-bedrock",
      PI_DEFAULT_MODEL: "eu.anthropic.claude-sonnet-5",
      PI_DEFAULT_CREDENTIALS: "host",
    };
    expect(resolveDeploymentModel(taskRole)).toEqual({
      provider: "amazon-bedrock",
      model: "eu.anthropic.claude-sonnet-5",
      key: undefined,
      configured: true,
      hostCredentials: true,
    });
  });

  it("leaves a deployment that did not opt in unchanged, even with host credentials", () => {
    vi.stubEnv("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "/v2/credentials/example");
    const withoutOptIn = {
      PI_DEFAULT_PROVIDER: "amazon-bedrock",
      PI_DEFAULT_MODEL: "eu.anthropic.claude-sonnet-5",
    };
    expect(resolveDeploymentModel(withoutOptIn).configured).toBe(false);
    expect(
      resolveDeploymentModel({ ...withoutOptIn, PI_DEFAULT_CREDENTIALS: "true" }).configured,
    ).toBe(false);
  });

  it("allows Bedrock instance roles without environment credentials, but requires an explicit model", () => {
    const provider = { PI_DEFAULT_PROVIDER: "amazon-bedrock", PI_DEFAULT_CREDENTIALS: "host" };
    expect(resolveDeploymentModel(provider).configured).toBe(false);
    expect(
      resolveDeploymentModel({ ...provider, PI_DEFAULT_MODEL: "eu.anthropic.claude-sonnet-5" }),
    ).toMatchObject({
      configured: true,
      hostCredentials: true,
      key: undefined,
    });
  });

  it("does not assume host authentication for other providers", () => {
    expect(
      resolveDeploymentModel({
        PI_DEFAULT_PROVIDER: "unknown",
        PI_DEFAULT_MODEL: "example-model",
        PI_DEFAULT_CREDENTIALS: "host",
      }).configured,
    ).toBe(false);
  });
});

describe("hostCredentialSource", () => {
  it("names the cloud identity a provider authenticates with from the host", () => {
    expect(hostCredentialSource("amazon-bedrock")).toBe("AWS IAM");
    expect(hostCredentialSource("google-vertex")).toBe("Google Cloud");
  });

  it("uses a DeepSeek deployment key when the provider is deepseek", () => {
    // Regression: deepseek was absent from the keys map while this deployment ran
    // PI_DEFAULT_PROVIDER=deepseek with DEEPSEEK_API_KEY set. `configured` stayed false, so a
    // user without a personal credential was sent to "Connect a model" and asked for an API
    // key — measured on a fresh account. The two existing accounts hold their own DeepSeek
    // credential, which is why nobody noticed.
    expect(
      resolveDeploymentModel({
        PI_DEFAULT_PROVIDER: "deepseek",
        PI_DEFAULT_MODEL: "deepseek-v4-pro",
        DEEPSEEK_API_KEY: "ds-key",
      }),
    ).toEqual({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      key: "ds-key",
      configured: true,
      hostCredentials: false,
    });
  });

  it("still refuses to hand another vendor's key to deepseek", () => {
    // The principle the existing test pins: a provider without its OWN key yields none.
    expect(
      resolveDeploymentModel({ PI_DEFAULT_PROVIDER: "deepseek", OPENROUTER_API_KEY: "or-key" }),
    ).toMatchObject({ key: undefined, configured: false });
  });
});
