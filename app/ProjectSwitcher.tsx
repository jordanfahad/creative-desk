"use client";

import { useRef } from "react";
import type { Project } from "@/lib/project";

// The active-project picker in the nav. Submits the switch action on change.
export default function ProjectSwitcher({
  projects,
  activeId,
  switchAction,
}: {
  projects: Project[];
  activeId: number;
  switchAction: (fd: FormData) => Promise<void>;
}) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form action={switchAction} ref={ref} style={{ margin: 0 }}>
      <select
        name="project_id"
        defaultValue={activeId}
        onChange={() => ref.current?.requestSubmit()}
        aria-label="Active project"
        title="Switch project"
        style={{ width: "auto", padding: "5px 10px", fontSize: 13, fontWeight: 600 }}
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </form>
  );
}
