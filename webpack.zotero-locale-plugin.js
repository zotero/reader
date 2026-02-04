let https = require('https');
let fs = require('fs');
let path = require('path');

const OUTPUT_PATH = path.resolve(__dirname, './locales');
const SIGNATURE_PATH = path.join(OUTPUT_PATH, '.signature');

// Static flags to ensure the plugin executes only once
let pluginActivated = false;
let filesProcessed = false;

class ZoteroLocalePlugin {
	constructor(options) {
		this.locales = options.locales;
		this.commitHash = options.commitHash;
		// Normalize files to { src, dest } where src is repo-relative with a {locale} placeholder
		// Plain strings like 'reader.ftl' expand to 'chrome/locale/{locale}/zotero/reader.ftl'
		this.files = options.files.map((file) => {
			if (typeof file === 'string') {
				return { src: `chrome/locale/{locale}/zotero/${file}`, dest: file };
			}
			return file;
		});
	}

	getRemoteURL() {
		return `https://raw.githubusercontent.com/zotero/zotero/${this.commitHash}`;
	}

	async downloadFile(url, outputPath) {
		return new Promise((resolve, reject) => {
			let file = fs.createWriteStream(outputPath);
			https.get(url, (response) => {
				if (response.statusCode === 200) {
					response.pipe(file);
					file.on('finish', () => {
						file.close(resolve);
					});
				}
				else {
					reject(new Error(`Failed to download file (${response.statusCode}): ${url}`));
				}
			}).on('error', (err) => {
				fs.unlink(outputPath, () => reject(err));
			});
		});
	}

	getRepoRoot() {
		let parentDir = path.resolve(__dirname, '..');
		if (fs.existsSync(path.join(parentDir, 'chrome', 'locale'))) {
			return parentDir;
		}
		return null;
	}

	async copyLocalFiles(repoRoot) {
		// Remove and recreate the output directory
		if (fs.existsSync(OUTPUT_PATH)) {
			fs.rmSync(OUTPUT_PATH, { recursive: true, force: true });
		}
		fs.mkdirSync(OUTPUT_PATH, { recursive: true });

		for (let locale of this.locales) {
			let localeDir = path.join(OUTPUT_PATH, locale);
			fs.mkdirSync(localeDir, { recursive: true });

			for (let { src, dest } of this.files) {
				let srcPath = path.join(repoRoot, src.replace('{locale}', locale));
				let destPath = path.join(localeDir, dest);

				try {
					fs.copyFileSync(srcPath, destPath);
				}
				catch (e) {
					console.error(`Failed to copy ${srcPath}:`, e.message);
				}
			}
		}
	}

	// Downloads locale files if the commit hash has changed.
	async processFiles() {
		// If inside zotero-client, copy from the local tree
		let repoRoot = this.getRepoRoot();
		if (repoRoot) {
			console.log(`Copying locale files from ${repoRoot}`);
			await this.copyLocalFiles(repoRoot);
			return;
		}

		// Load the previous commit hash from the plain text .signature file
		let lastCommitHash = null;
		try {
			if (fs.existsSync(SIGNATURE_PATH)) {
				lastCommitHash = fs.readFileSync(SIGNATURE_PATH, 'utf8').trim(); // Read as plain text
			}
		}
		catch (err) {
			console.error('Error reading .signature file:', err);
		}

		// If the commit hash has changed
		if (lastCommitHash !== this.commitHash) {
			console.log(`Detected commit hash change (was: ${lastCommitHash}, now: ${this.commitHash}). Clearing and downloading locale files...`);

			// Remove and recreate the output directory
			try {
				if (fs.existsSync(OUTPUT_PATH)) {
					fs.rmSync(OUTPUT_PATH, { recursive: true, force: true });
					console.log(`Deleted existing locale directory: ${OUTPUT_PATH}`);
				}
				fs.mkdirSync(OUTPUT_PATH, { recursive: true });
				console.log(`Recreated locale directory: ${OUTPUT_PATH}`);
			}
			catch (err) {
				console.error('Error while resetting locale directory:', err);
				return;
			}

			let remoteBase = this.getRemoteURL();

			for (let locale of this.locales) {
				let localeDir = path.join(OUTPUT_PATH, locale);
				fs.mkdirSync(localeDir, { recursive: true });

				for (let { src, dest } of this.files) {
					let url = `${remoteBase}/${src.replace('{locale}', locale)}`;
					let outputFile = path.join(localeDir, dest);

					try {
						console.log(`Downloading ${url} -> ${outputFile}`);
						await this.downloadFile(url, outputFile);
					}
					catch (error) {
						console.error(`Failed to download ${url}:`, error.message);
					}
				}
			}

			// Save the new commit hash in the .signature file as plain text
			try {
				fs.writeFileSync(SIGNATURE_PATH, this.commitHash, 'utf8');
				console.log(`Updated commit hash saved to ${SIGNATURE_PATH}`);
			}
			catch (err) {
				console.error('Error writing to .signature file:', err);
			}
		}
		else {
			console.log(`No changes detected (current hash: ${this.commitHash}). Skipping downloads.`);
		}
	}

	apply(compiler) {
		// Prevent plugin from running multiple times
		if (pluginActivated) {
			return;
		}
		// Mark plugin as activated
		pluginActivated = true;
		// Hook into Webpack's lifecycle
		let run = async () => {
			if (filesProcessed) {
				return;
			}
			filesProcessed = true;
			console.log('ZoteroLocalePlugin is running...');
			await this.processFiles();
		};
		compiler.hooks.beforeRun.tapPromise('ZoteroLocalePlugin', run);
		compiler.hooks.watchRun.tapPromise('ZoteroLocalePlugin', run);
	}
}

module.exports = ZoteroLocalePlugin;
