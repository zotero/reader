import { computeWordSpacingThreshold } from './xpdf'

function overlaps(ch1, ch2, rotation) {
	if (rotation === 0) {
		if (
			ch1.rect[1] <= ch2.rect[1] && ch2.rect[1] <= ch1.rect[3] ||
			ch2.rect[1] <= ch1.rect[1] && ch1.rect[1] <= ch2.rect[3]
		) {
			return true;
		}
	}
	else {
		if (
			ch1.rect[0] <= ch2.rect[0] && ch2.rect[0] <= ch1.rect[2] ||
			ch2.rect[0] <= ch1.rect[0] && ch1.rect[0] <= ch2.rect[2]
		) {
			return true;
		}
	}
	return false;
}

export function getLines(chs) {
	let lines = [];
	let line = {
		chs: []
	};
	for (let ch of chs) {
		let prevCh = line.chs[line.chs.length - 1];
		if (ch.rotation && ch.rotation % 90 !== 0) continue;
		if (ch.c === ' ') {
			if (line.length) {
				line[line.length - 1].spaceAfter = true;
			}
			continue
		}

		if (!line.chs.length) {
			line.chs.push(ch);
		}
		else {

			let newLine = false;

			if (!ch.rotation) {
				if (prevCh.rect[0] > ch.rect[0]) {
					newLine = true;
				}
			}
			else if (ch.rotation === 90) {
				if (prevCh.rect[1] > ch.rect[1]) {
					newLine = true;
				}
			}
			else if (ch.rotation === 270) {
				if (prevCh.rect[1] < ch.rect[1]) {
					newLine = true;
				}
			}
			if (ch.rotation === 180) {
				if (prevCh.rect[0] < ch.rect[0]) {
					newLine = true;
				}
			}

			if (
				newLine ||
				prevCh.rotation !== ch.rotation ||
				!overlaps(prevCh, ch, ch.rotation)
			) {
				lines.push(line);
				line = { chs: [ch] };
			}
			else {
				line.chs.push(ch);
			}
		}
	}

	if (line.chs.length) lines.push(line);

	for (let line of lines) {
		line.rect = line.chs[0].rect.slice();
		for (let ch of line.chs) {
			line.rect[0] = Math.min(line.rect[0], ch.rect[0]);
			line.rect[1] = Math.min(line.rect[1], ch.rect[1]);
			line.rect[2] = Math.max(line.rect[2], ch.rect[2]);
			line.rect[3] = Math.max(line.rect[3], ch.rect[3]);
		}
	}

	for (let line of lines) {
		line.words = [];

		let rot;
		let rotation = line.chs[0].rotation;
		if (!rotation) {
			rot = 0;
		}
		else if (rotation === 90) {
			rot = 1;
		}
		else if (rotation === 180) {
			rot = 2;
		}
		else if (rotation === 270) {
			rot = 3;
		}

		let wordSp = computeWordSpacingThreshold(line.chs, rot);

		let i = 0;
		while (i < line.chs.length) {
			let sp = wordSp - 1;
			let spaceAfter = false;
			let j;
			for (j = i + 1; j < line.chs.length; ++j) {
				let ch = line.chs[j - 1];
				let ch2 = line.chs[j];
				sp = (rot & 1) ? (ch2.rect[1] - ch.rect[3]) : (ch2.rect[0] - ch.rect[2]);
				if (sp > wordSp) {
					spaceAfter = true;
					break;
				}
			}

			let word = {
				chs: line.chs.slice(i, j),
				spaceAfter
			};

			line.words.push(word);
			i = j;
		}
	}

	return lines;
}

// module.exports = {
// 	getLines
// };
