const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

export function readinessText(view) {
  const problems = view.problems ?? [];
  const title = problems.map((problem) => (problem.steps > 1 ? `${problem.text} (${problem.steps} steps)` : problem.text)).join('\n');
  const first = problems[0]?.text;
  const more = problems.length > 1 ? ` (+${problems.length - 1} more)` : '';
  if (view.verdict === 'blocked') return { text: `Won't run: ${first ?? 'the remote says it is blocked'}${more}`, warn: true, title };
  if (view.verdict === 'nothing') {
    return { text: view.steps === 0 ? 'Has no steps' : `Runs nothing: ${first ?? 'every step would be skipped'}${more}`, warn: true, title };
  }
  if (problems.length > 0) return { text: `Ready · ${plural(view.steps, 'step')}, ${plural(problems.length, 'warning')}`, warn: true, title };
  return { text: `Ready · ${plural(view.steps, 'step')}`, warn: false, title };
}
