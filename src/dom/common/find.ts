import {
	NewAnnotation,
	WADMAnnotation
} from "../../common/types";
import { DisplayedAnnotation } from "./components/overlay/annotation-overlay";

abstract class FindProcessor {
	readonly query: string;

	readonly highlightAll: boolean;

	readonly caseSensitive: boolean;

	readonly entireWord: boolean;

	protected constructor(options: {
		query: string,
		highlightAll: boolean,
		caseSensitive: boolean,
		entireWord: boolean
	}) {
		this.query = options.query;
		this.highlightAll = options.highlightAll;
		this.caseSensitive = options.caseSensitive;
		this.entireWord = options.entireWord;
	}

	abstract getSectionAnnotations(section: number): DisplayedAnnotation[];
}

export default FindProcessor;
