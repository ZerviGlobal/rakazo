import { describe, expect, it, vi } from "vitest";
import { commitSpaceRename, sidebarGroupsForSpaces } from "./space-sidebar";

// `sectionId` is widened deliberately: the fixture returns null by default, but tests also
// build bots that belong to a section, and an inferred literal `null` rejects that.
function chat(id: string, name: string, sectionId: string | null = null) {
  return {
    id,
    name,
    title: "",
    preview: "",
    pinned: false,
    sectionId,
    parentBotId: null,
  };
}

function space(
  id: string,
  name: string,
  options: { canRename?: boolean; canDelete?: boolean; bots?: ReturnType<typeof chat>[] } = {},
) {
  return {
    id,
    name,
    canRename: options.canRename ?? false,
    canDelete: options.canDelete ?? false,
    bots: options.bots ?? [chat(`${id}-bot`, "Chief")],
    groups: [],
    botSections: [],
  };
}

describe("sidebarGroupsForSpaces", () => {
  it("keeps rename on the only space without showing its name", () => {
    const [group] = sidebarGroupsForSpaces([space("space-1", "Personal", { canRename: true })], "");

    expect(group).toMatchObject({
      title: null,
      spaceName: "Personal",
      canRenameSpace: true,
      canDeleteSpace: false,
      showLock: false,
    });
    expect(group?.bots).toHaveLength(1);
  });

  it("still names each space once there is more than one", () => {
    const groups = sidebarGroupsForSpaces(
      [
        space("space-1", "Personal", { canRename: true }),
        space("space-2", "Support", { canRename: true, canDelete: true, bots: [] }),
      ],
      "",
    );

    expect(groups.map((group) => group.title)).toEqual(["Personal", "Support"]);
    expect(groups[0]).toMatchObject({ canRenameSpace: true, canDeleteSpace: false });
    expect(groups[1]).toMatchObject({
      canRenameSpace: true,
      canDeleteSpace: true,
      emptySpaceId: "space-2",
    });
  });

  it("hides space actions while a search removes every chat from the only space", () => {
    expect(
      sidebarGroupsForSpaces([space("space-1", "Personal", { canRename: true })], "missing"),
    ).toEqual([]);
  });
});

describe("commitSpaceRename", () => {
  it("applies the saved name when the following refresh fails", async () => {
    const rename = vi.fn(async () => undefined);
    const apply = vi.fn();
    const refresh = vi.fn(async () => {
      throw new Error("list failed");
    });

    await expect(commitSpaceRename({ rename, apply, refresh })).resolves.toBeUndefined();
    expect(rename).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does not apply a name when the rename itself fails", async () => {
    const apply = vi.fn();
    const refresh = vi.fn(async () => undefined);

    await expect(
      commitSpaceRename({
        rename: async () => {
          throw new Error("Space deletion is already in progress");
        },
        apply,
        refresh,
      }),
    ).rejects.toThrow("Space deletion is already in progress");
    expect(apply).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("empty departments", () => {
  // Measured on the live deployment: creating three departments showed only two, because the
  // grouping helper drops sections with no members. With no row there is nothing to rename or
  // delete, so a department made on a phone appeared to vanish — which reads as "the button
  // failed". It must render even while empty.
  function spaceWithSections(sections: { id: string; name: string }[], bots = [chat("b1", "Chief")]) {
    return { ...space("space-1", "Personal", { bots }), botSections: sections };
  }

  it("renders a department that has no members yet", () => {
    const groups = sidebarGroupsForSpaces(
      [spaceWithSections([{ id: "sec-1", name: "ฝ่ายขาย" }])],
      "",
    );
    const section = groups.find((group) => group.title === "ฝ่ายขาย");
    expect(section).toBeDefined();
    expect(section).toMatchObject({ sectionId: "sec-1" });
    expect(section?.bots).toEqual([]);
    // The unassigned bot still has its own group; that is correct and comes first.
    expect(groups.map((group) => group.title)).toEqual(["Unassigned", "ฝ่ายขาย"]);
  });

  it("does not duplicate a department that already has members", () => {
    const assigned = chat("b1", "Chief", "sec-1");
    const groups = sidebarGroupsForSpaces(
      [spaceWithSections([{ id: "sec-1", name: "ฝ่ายขาย" }], [assigned])],
      "",
    );
    expect(groups.filter((group) => group.title === "ฝ่ายขาย")).toHaveLength(1);
    expect(groups.find((group) => group.title === "ฝ่ายขาย")?.bots).toHaveLength(1);
  });

  it("keeps every empty department, in section order", () => {
    const groups = sidebarGroupsForSpaces(
      [
        spaceWithSections([
          { id: "s1", name: "ฝ่ายขาย" },
          { id: "s2", name: "ฝ่ายผลิต" },
          { id: "s3", name: "ฝ่ายบัญชี" },
        ]),
      ],
      "",
    );
    // "Unassigned" leads because the fixture's bot belongs to no section.
    expect(groups.map((group) => group.title)).toEqual([
      "Unassigned",
      "ฝ่ายขาย",
      "ฝ่ายผลิต",
      "ฝ่ายบัญชี",
    ]);
  });
});
