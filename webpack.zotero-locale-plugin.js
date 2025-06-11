let https = require('https');
let fs = require('fs');
let path = require('path');

const OUTPUT_PATH = path.resolve(__dirname, './locales');
const SIGNATURE_PATH = path.join(OUTPUT_PATH, '.signature');

// Static flag to ensure the plugin executes only once
let pluginActivated = false;

class ZoteroLocalePlugin {
	constructor(options) {
		this.files = options.files;
		this.locales = options.locales;
		this.commitHash = options.commitHash;
	}

	getRepoURL() {
		return `https://raw.githubusercontent.com/zotero/zotero/${this.commitHash}/chrome/locale`;
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

	// Downloads locale files if the commit hash has changed.
	async processFiles() {
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

			let repoUrl = this.getRepoURL();

			for (let locale of this.locales) {
				for (let file of this.files) {
					let url = `${repoUrl}/${locale}/zotero/${file}`;
					let localeDir = path.join(OUTPUT_PATH, locale);
					let outputFile = path.join(localeDir, file);

					// Ensure the directory exists
					fs.mkdirSync(localeDir, { recursive: true });

					// Download the file
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
		compiler.hooks.beforeRun.tapPromise('ZoteroLocalePlugin', async () => {
			console.log('ZoteroLocalePlugin is running...');
			await this.processFiles();
		});
	}
}

module.exports = ZoteroLocalePlugin;
