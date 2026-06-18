"use client";

export default function DeleteProjectButton({
  projectId,
  name,
  action,
}: {
  projectId: number;
  name: string;
  action: (fd: FormData) => Promise<void>;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Delete "${name}" and everything in it (brand kit, guidelines, assets, jobs)? This cannot be undone.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="project_id" value={projectId} />
      <button className="btn danger sm" type="submit">
        Delete
      </button>
    </form>
  );
}
