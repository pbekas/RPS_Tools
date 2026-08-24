import type { ContractGroup } from "@/lib/contractTypes";
import {
  ALL_TOOLSET_IDS,
  grantedToolsets,
  hasModule,
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
  const allGroups = legacyFull;
  const canViewAgreements = allGroups || groupSlugs.length > 0;
  const canViewVendorContacts =
    legacyFull || mods.includes(CONTRACT_VENDOR_CONTACTS);
  const canManageVendorFiles =
    legacyFull || mods.includes(CONTRACT_VENDOR_FILES);
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
  const toolsets: ToolsetId[] = ALL_TOOLSET_IDS.filter((id) => {
    if (id === "contracts") return mods.some(isContractsModule);
    return mods.includes(id);
  });
  if (!toolsets.length) {
    toolsets.push("call_qa");
  }
  const access = resolveContractAccess(user);
  return {
    toolsets,
    allContractTypes: access.allGroups,
    groupSlugs: access.allGroups ? groups.map((g) => g.slug) : access.groupSlugs,
    vendorContacts: access.canViewVendorContacts,
    vendorFiles: access.canManageVendorFiles,
  };
}

export type AccessGrantCaps = {
  toolsets: ToolsetId[];
  allContractTypes: boolean;
  contractGroupSlugs: string[];
  vendorContacts: boolean;
  vendorFiles: boolean;
};

export function accessGrantCaps(
  actor: SessionUserLike | null | undefined
): AccessGrantCaps {
  const access = resolveContractAccess(actor);
  const toolsets = grantedToolsets(actor).filter((id) => {
    if (id !== "contracts") return true;
    return access.canViewAgreements;
  });
  return {
    toolsets,
    allContractTypes: access.allGroups,
    contractGroupSlugs: access.allGroups ? [] : access.groupSlugs,
    vendorContacts: access.canViewVendorContacts,
    vendorFiles: access.canManageVendorFiles,
  };
}

function isFullContractsGrant(modules: string[]): boolean {
  const mods = modulesList({ modules });
  return (
    mods.includes("contracts") &&
    !mods.some((m) => m.startsWith("contracts:"))
  );
}

export function actorCanAssignModule(
  actor: SessionUserLike | null | undefined,
  module: string
): boolean {
  const value = String(module || "").trim();
  if (!value || !actor?.email) return false;
  if (value === "contracts") {
    return resolveContractAccess(actor).canViewAgreements;
  }
  if ((ALL_TOOLSET_IDS as string[]).includes(value)) {
    return hasModule(actor, value as ToolsetId);
  }
  const access = resolveContractAccess(actor);
  if (value === CONTRACT_VENDOR_CONTACTS) return access.canViewVendorContacts;
  if (value === CONTRACT_VENDOR_FILES) return access.canManageVendorFiles;
  if (value.startsWith(CONTRACT_GROUP_PREFIX)) {
    return canAccessContractGroup(
      access,
      value.slice(CONTRACT_GROUP_PREFIX.length)
    );
  }
  return false;
}

function expandBareContractsToActorScope(
  actor: SessionUserLike,
  modules: string[]
): string[] {
  const access = resolveContractAccess(actor);
  const hasExtras = modules.some((m) => m.startsWith("contracts:"));
  if (!modules.includes("contracts") || hasExtras) return modules;
  if (
    access.allGroups &&
    access.canViewVendorContacts &&
    access.canManageVendorFiles
  ) {
    return modules;
  }
  const extras: string[] = [];
  for (const slug of access.groupSlugs) extras.push(contractGroupGrant(slug));
  if (access.canViewVendorContacts) extras.push(CONTRACT_VENDOR_CONTACTS);
  if (access.canManageVendorFiles) extras.push(CONTRACT_VENDOR_FILES);
  return Array.from(new Set([...modules, ...extras]));
}

/** Apply only the grants the actor themselves has. Other modules on the target stay as-is. */
export function constrainModuleGrants(
  actor: SessionUserLike | null | undefined,
  existing: string[] | null | undefined,
  requested: string[] | null | undefined
): string[] {
  const existingN = modulesList({ modules: existing || [] });
  let requestedN = modulesList({ modules: requested || [] });
  if (!actor?.email) return existingN;

  const actorFull =
    isFullContractsGrant(modulesList(actor)) ||
    (resolveContractAccess(actor).allGroups &&
      resolveContractAccess(actor).canViewVendorContacts &&
      resolveContractAccess(actor).canManageVendorFiles);

  if (isFullContractsGrant(existingN) && !actorFull) {
    const lockedContracts = existingN.filter(isContractsModule);
    const lockedOther = existingN.filter(
      (m) => !isContractsModule(m) && !actorCanAssignModule(actor, m)
    );
    const nextOther = requestedN.filter(
      (m) => !isContractsModule(m) && actorCanAssignModule(actor, m)
    );
    return Array.from(new Set([...lockedContracts, ...lockedOther, ...nextOther]));
  }

  requestedN = expandBareContractsToActorScope(actor, requestedN);
  const locked = existingN.filter((m) => !actorCanAssignModule(actor, m));
  const next = requestedN.filter((m) => actorCanAssignModule(actor, m));
  return Array.from(new Set([...locked, ...next]));
}
