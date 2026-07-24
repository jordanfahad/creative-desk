"use client";

export default function DeleteRenderButton({
  jobId,
  renderId,
  action,
}: {
  jobId: number;
  renderId: number;
  action: (fd: FormData) => Promise<void>;
}) {
  return (
    <form
      action={action}
      style={{ margin: 0 }}
      onSubmit={(e) => {
        if (!confirm("Delete this result? The file is removed too. You can regenerate fresh ones anytime.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="job_id" value={jobId} />
      <input type="hidden" name="render_id" value={renderId} />
      <button className="btn danger sm" type="submit">
        Delete
      </button>
    </form>
  );
}
