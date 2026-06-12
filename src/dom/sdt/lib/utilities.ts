import type { TextNode } from '../../../../structured-document-text/schema';

export function isTextNodeArray(content: unknown[]): content is TextNode[] {
	return content.length > 0 && typeof (content[0] as TextNode)?.text === 'string';
}
