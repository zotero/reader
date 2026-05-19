import { ContentBlockNode, ListItemNode, TableRowNode, TextNode } from '../../../../structured-document-text/schema';

export function isTextNodeArray(content: unknown[]): content is TextNode[] {
	return content.length > 0 && 'text' in (content[0] as TextNode | never);
}

export function isContentBlockNode(node: ContentBlockNode | ListItemNode | TableRowNode): node is ContentBlockNode {
	return node.type !== 'listitem' && node.type !== 'tablerow';
}
