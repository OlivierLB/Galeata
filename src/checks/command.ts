/** A copyable POSIX display of the structured argv. Execution never uses a shell. */
export function formatCommand(program: string, args: readonly string[]) {
  return [program, ...args].map(value => /^[A-Za-z0-9_./:@%+=,-]+$/.test(value)
    ? value : "'" + value.replaceAll("'", "'\"'\"'") + "'").join(' ');
}
