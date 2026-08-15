import { readPackageIdentity } from "@trebired/utils";

const packageIdentity = readPackageIdentity({
    fallbackSlug: "tasks",
    fallbackVersion: "1.2.2",
    packageJsonUrl: new URL("../package.json", import.meta.url),
});
const PACKAGE_NAME = packageIdentity.name;
const PACKAGE_VERSION = packageIdentity.version;
const PACKAGE_ORGANIZATION_NAME = packageIdentity.organizationName;
const PACKAGE_SLUG = packageIdentity.slug;
const buildPackageLogGroup = packageIdentity.buildLogGroup;

export {
  buildPackageLogGroup,
  PACKAGE_NAME,
  PACKAGE_ORGANIZATION_NAME,
  PACKAGE_SLUG,
  PACKAGE_VERSION,
};
