export {
  generateEndpointDoc,
  generateOverviewDoc,
  generateTutorialDoc,
  generateAllEndpointDocs,
  type DocWriterOptions,
  type GeneratedDoc,
} from "./doc-writer";

export {
  generateCodeExample,
  generateMultiLanguageExamples,
  type SupportedLanguage,
  type CodeExampleResult,
} from "./code-examples";

export {
  generateErrorGuide,
  generateEndpointErrorDoc,
} from "./error-guide";

export {
  detectAPIChanges,
  generateChangelogDoc,
  type APIChange,
  type ChangelogEntry,
} from "./changelog";

export {
  buildSearchIndex,
  exportSearchIndexJSON,
  exportSearchIndexSQL,
  type SearchEntry,
  type SearchIndex,
  type SearchIndexOptions,
} from "./search-index";

export { generateWithClaude, generateWithClaudeStreaming, type ClaudeOptions } from "./claude-client";
