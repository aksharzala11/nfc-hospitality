#!/usr/bin/env node
/**
 * Creates a send-only IAM user for the Vercel deployment and writes its access
 * key into .env.production. Run from the repo root with your admin AWS CLI
 * credentials:
 *
 *   node scripts/setup-vercel-aws-key.mjs
 *
 * The user can only call ses:SendEmail / ses:SendRawEmail and publish SMS via
 * SNS. Re-running rotates the key (old keys are deleted).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const USER = "naam-hub-vercel";
const REGION = "us-east-1";
const ENV_FILE = ".env.production";

const aws = (...args) => execFileSync("aws", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const awsJson = (...args) => JSON.parse(aws(...args, "--output", "json"));

const account = awsJson("sts", "get-caller-identity").Account;
console.log(`AWS account ${account}`);

try {
  aws("iam", "get-user", "--user-name", USER);
  console.log(`IAM user ${USER} already exists`);
} catch {
  aws("iam", "create-user", "--user-name", USER, "--tags", "Key=app,Value=hospitality-hub");
  console.log(`Created IAM user ${USER}`);
}

const policy = {
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Action: ["ses:SendEmail", "ses:SendRawEmail"],
      // SES authorises a send against the identity and, when SES_CONFIGURATION_SET is set,
      // the configuration set too (bounce/complaint events to SNS).
      Resource: [
        `arn:aws:ses:${REGION}:${account}:identity/*`,
        `arn:aws:ses:${REGION}:${account}:configuration-set/naam-hospitality-hub`,
      ],
    },
    {
      Effect: "Allow",
      Action: ["sns:Publish"],
      Resource: "*",
      Condition: { Null: { "sns:TopicArn": "true" } },
    },
  ],
};
const dir = mkdtempSync(join(tmpdir(), "naam-hub-"));
const policyPath = join(dir, "policy.json");
writeFileSync(policyPath, JSON.stringify(policy));
aws("iam", "put-user-policy", "--user-name", USER, "--policy-name", "hospitality-hub-otp-send", "--policy-document", `file://${policyPath}`);
console.log("Attached send-only policy");

const existing = awsJson("iam", "list-access-keys", "--user-name", USER).AccessKeyMetadata;
for (const k of existing) {
  aws("iam", "delete-access-key", "--user-name", USER, "--access-key-id", k.AccessKeyId);
  console.log(`Deleted old access key ${k.AccessKeyId}`);
}
const key = awsJson("iam", "create-access-key", "--user-name", USER).AccessKey;

let env = readFileSync(ENV_FILE, "utf8");
const set = (name, value) => {
  const line = `${name}="${value}"`;
  env = env.match(new RegExp(`^${name}=.*$`, "m")) ? env.replace(new RegExp(`^${name}=.*$`, "m"), line) : `${env.trimEnd()}\n${line}\n`;
};
set("AWS_ACCESS_KEY_ID", key.AccessKeyId);
set("AWS_SECRET_ACCESS_KEY", key.SecretAccessKey);
set("AWS_REGION", REGION);
writeFileSync(ENV_FILE, env);
console.log(`Wrote new access key ${key.AccessKeyId} into ${ENV_FILE}. Redeploy to Vercel to apply.`);
