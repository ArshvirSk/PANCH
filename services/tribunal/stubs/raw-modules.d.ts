// TypeScript ambient declarations for esbuild text-loader imports.
// At runtime esbuild inlines these files as strings; the loader is wired in
// infra/lib/WorkflowStack.ts via `bundling: { loader: { '.md': 'text' } }`.
declare module '*.md?raw' {
  const content: string;
  export default content;
}
