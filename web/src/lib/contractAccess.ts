import type { ContractGroup } from "@/lib/contractTypes";
import {
  ALL_TOOLSET_IDS,
  isAdmin,
  type SessionUserLike,
  type ToolsetId,
} from "@/lib/permissions";

export const CONTRACT_GROUP_PREFIX = "contracts:group:";
export const CONTRACT_VENDOR_CONTACTS = "contracts:vendor_contacts";
export const CONTRACT_VENDOR_FILES = "contracts:vendor_files";

export type ContractAccess = {
  hasContractsNav: boolean;
  allGroups: boolean;
  groupSlugs: string[];
  canViewAgreements: boolean;
  canViewVendorContacts: boolean;
  canManageVendorFiles: boolean;
  canOpenVendors: boolean;
};

export function modulesList(user: SessionUserLike | null | undefined): string[] {
  return (user?.modules || []).map((m) => String(m).trim()).filter(Boolean);
}

export function isContractsModule(value: string): boolean {
  return value === "contracts" || value.startsWith("contracts:");
}

export function contractGroupGrant(slug: string): string {
  return `${CONTRACT_GROUP_PREFIX}${slug}`;
}

export function resolveContractAccess(
  user: SessionUserLike | null | undefined
): ContractAccess {
  if (!user?.email) {
    return {
      hasContractsNav: false,
      allGroups: false,
      groupSlugs: [],
      canViewAgreements: false,
      canViewVendorContacts: false,
      canManageVendorFiles: false,
      canOpenVendors: false,
    };
  }
  const mods = modulesList(user);
  const hasNav = mods.some(isContractsModule);
  const groupSlugs = mods
    .filter((m) => m.startsWith(CONTRACT_GROUP_PREFIX))
    .map((m) => m.slice(CONTRACT_GROUP_PREFIX.length))
    .filter(Boolean);
  const hasExplicitCaps =
    groupSlugs.length > 0 ||
    mods.includes(CONTRACT_VENDOR_CONTACTS) ||
    mods.includes(CONTRACT_VENDOR_FILES);
  const legacyFull = mods.includes("contracts") && !hasExplicitCaps;
  const adminFull = isAdmin(user) && hasNav;
  const allGroups = adminFull || legacyFull;
  const canViewAgreements = allGroups || groupSlugs.length > 0;
  const canViewVendorContacts =
    adminFull ||
    legacyFull ||
    mods.includes(CONTRACT_VENDOR_CONTACTS);
  const canManageVendorFiles =
    adminFull || legacyFull || mods.includes(CONTRACT_VENDOR_FILES);
  return {
    hasContractsNav: hasNav,
    allGroups,
    groupSlugs,
    canViewAgreements,
    canViewVendorContacts,
    canManageVendorFiles,
    canOpenVendors: canViewVendorContacts || canManageVendorFiles || canViewAgreements,
  };
}

export function canAccessContractGroup(
  access: ContractAccess,
  groupSlug?: string | null
): boolean {
  if (access.allGroups) return true;
  if (!groupSlug) return false;
  return access.groupSlugs.includes(groupSlug);
}

export function buildModuleGrants(input: {
  toolsets: string[];
  allContractTypes: boolean;
  groupSlugs: string[];
  knownGroupSlugs?: string[];
  vendorContacts: boolean;
  vendorFiles: boolean;
}): string[] {
  const toolsets = Array.from(
    new Set(
      input.toolsets
        .map((m) => String(m).trim())
        .filter((m): m is ToolsetId => (ALL_TOOLSET_IDS as string[]).includes(m))
    )
  );
  const extras: string[] = [];
  const wantsContracts = toolsets.includes("contracts");
  const slugs = Array.from(new Set(input.groupSlugs.filter(Boolean)));
  const known = input.knownGroupSlugs || slugs;

  if (wantsContracts) {
    const fullLegacy =
      input.allContractTypes && input.vendorContacts && input.vendorFiles;
    if (!fullLegacy) {
      const typeSlugs = input.allContractTypes ? known : slugs;
      for (const slug of typeSlugs) extras.push(contractGroupGrant(slug));
      if (input.vendorContacts) extras.push(CONTRACT_VENDOR_CONTACTS);
      if (input.vendorFiles) extras.push(CONTRACT_VENDOR_FILES);
    }
  } else {
    if (input.vendorContacts) extras.push(CONTRACT_VENDOR_CONTACTS);
    if (input.vendorFiles) extras.push(CONTRACT_VENDOR_FILES);
  }

  return Array.from(new Set([...toolsets, ...extras]));
}

export function parseContractGrantState(
  user: SessionUserLike | null | undefined,
  groups: ContractGroup[]
): {
  toolsets: ToolsetId[];
  allContractTypes: boolean;
  groupSlugs: string[];
  vendorContacts: boolean;
  vendorFiles: boolean;
} {
  const mods = modulesList(user);
  const toolsets: ToolsetId[] = ALL_TOOLSET_IDS.filter((id) => mods.includes(id));
  if (!toolsets.length && !mods.some(isContractsModule)) {
    toolsets.push("call_qa");
  }
  const access = resolveContractAccess(user);
  return {
    toolsets: toolsets.length ? toolsets : (["call_qa"] as ToolsetId[]),
    allContractTypes: access.allGroups || access.groupSlugs.length === 0,
    groupSlugs: access.allGroups ? groups.map((g) => g.slug) : access.groupSlugs,
    vendorContacts: access.canViewVendorContacts,
    vendorFiles: access.canManageVendorFiles,
  };
}
