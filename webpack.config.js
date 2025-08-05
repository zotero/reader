const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const ZoteroLocalePlugin = require('./webpack.zotero-locale-plugin');

function generateReaderConfig(build) {
	const isESM = build === 'esm';

	const config = {
		name: build,
		mode: build === 'dev' ? 'development' : 'production',
		devtool: (build === 'zotero' || build === 'web') ? false : 'source-map',
		entry: isESM
			? { reader: './src/index.esm.js' }
			: {
				reader: [
					'./src/index.' + build + '.js',
					'./src/common/stylesheets/main.scss'
				]
			},
		output: {
			path: path.resolve(__dirname, './build/' + build),
			filename: isESM ? 'reader.mjs' : 'reader.js',
			publicPath: '',
			...(isESM
				? {
					module: true,
					library: {
						type: 'module',
					},
				}
				: {
					libraryTarget: 'umd',
					library: {
						name: 'reader',
						type: 'umd',
						umdNamedDefine: true,
					},
				}),
		},
		...(isESM && {
			experiments: {
				outputModule: true,
			},
		}),
		optimization: {
			minimize: build === 'web',
			minimizer: [new CssMinimizerPlugin(), '...'], // ... is for built-in TerserPlugin https://webpack.js.org/configuration/optimization/#optimizationminimizer
		},
		module: {
			rules: [
				{
					test: /\.(ts|js)x?$/,
					exclude: /node_modules/,
					use: {
						loader: 'babel-loader',
						options: {
							presets: [
								['@babel/preset-env', {
									useBuiltIns: false,
									targets: build === 'zotero' || build === 'dev'
										? { firefox: 115, chrome: 128 }
										: undefined
								}],
							],
						},
					},
				},
				build === 'dev' && {
					test: /\.tsx?$/,
					exclude: /node_modules/,
					use: 'ts-loader',
				},
				{
					test: /\.s?css$/,
					exclude: path.resolve(__dirname, './src/dom'),
					use: [
						MiniCssExtractPlugin.loader,
						{
							loader: 'css-loader',
						},
						{
							loader: 'postcss-loader',
						},
						{
							loader: 'sass-loader',
							options: {
								additionalData: `$platform: '${build}';`
							}
						},
					],
				},
				{
					test: /\.scss$/,
					include: path.resolve(__dirname, './src/dom'),
					use: [
						{
							loader: 'raw-loader',
						},
						{
							loader: 'sass-loader',
							options: {
								additionalData: `$platform: '${build}';`
							}
						}
					]
				},
				{
					test: /\.svg$/i,
					issuer: /\.[jt]sx?$/,
					use: ['@svgr/webpack'],
				},
				{
					test: /\.ftl$/,
					type: 'asset/source'
				}
			].filter(Boolean)
		},
		resolve: {
			extensions: ['.js', '.ts', '.tsx'],
		},
		plugins: [
			new ZoteroLocalePlugin({
				files: ['zotero.ftl', 'reader.ftl'],
				locales: ['en-US'],
				commitHash: '37f8c4d4f425244b5ead77bb7e129d828f62fb43',
			}),
			new CleanWebpackPlugin({
				cleanOnceBeforeBuildPatterns: ['**/*', '!pdf/**']
			}),
			new MiniCssExtractPlugin({
				filename: '[name].css',
			}),
			!isESM && new HtmlWebpackPlugin({
				template: './index.reader.html',
				filename: './[name].html',
				templateParameters: {
					build
				},
			}),
			new CopyWebpackPlugin({
				patterns: [
					{
						from: 'node_modules/mathjax-full/ts/output/chtml/fonts/tex-woff-v2/*.woff',
						to: './mathjax-fonts/[name].woff'
					}
				],
			}),
		],
	};

	if (build === 'zotero') {
		config.externals = {
			react: 'React',
			'react-dom': 'ReactDOM',
			'prop-types': 'PropTypes'
		};
	}
	else if (build === 'web') {
		config.externals = {
			// No support for importing EPUB annotations on the web, so no need for luaparse there
			luaparse: 'luaparse',
		};
	}
	else if (build === 'dev') {
		config.plugins.push(
			new CopyWebpackPlugin({
				patterns: [
					{ from: 'demo/epub/demo.epub', to: './' },
					{ from: 'demo/pdf/demo.pdf', to: './' },
					{ from: 'demo/snapshot/demo.html', to: './' }
				],
				options: {

				}
			})
		);
		config.devServer = {
			static: {
				directory: path.resolve(__dirname, 'build/'),
				watch: true,
			},
			devMiddleware: {
				writeToDisk: true,
			},
			open: '/dev/reader.html?type=pdf',
			port: 3000,
		};
	}

	else if (build === 'esm') {
		config.plugins.push(
			new CopyWebpackPlugin({
				patterns: [
					{ from: 'demo/epub', to: './epub' },
					{ from: 'demo/pdf', to: './pdf' },
					{ from: 'demo/snapshot', to: './snapshot' },
					{ from: 'demo/esm.html', to: './reader.html' }
				],
				options: {}
			})
		);
		config.devServer = {
			static: {
				directory: path.resolve(__dirname, 'build/'),
				watch: true,
			},
			devMiddleware: {
				writeToDisk: true,
			},
			open: '/esm/reader.html?type=epub',
			port: 3000,
		};
	}

	return config;
}

function generateViewConfig(build) {
	let config = {
		name: build,
		mode: build === 'view-dev' ? 'development' : 'production',
		devtool: build === 'web' ? false : 'source-map',
		entry: {
			view: [
				'./src/index.' + build + '.js',
				'./src/common/stylesheets/view.scss'
			],
		},
		output: {
			path: path.resolve(__dirname, './build/' + build),
			filename: 'view.js',
			libraryTarget: 'umd',
			publicPath: '',
			library: {
				name: 'view',
				type: 'umd',
				umdNamedDefine: true,
			},
		},
		optimization: {
			minimize: build === 'web',
			minimizer: [new CssMinimizerPlugin(), '...'], // ... is for built-in TerserPlugin https://webpack.js.org/configuration/optimization/#optimizationminimizer
		},
		module: {
			rules: [
				{
					test: /\.(js|jsx)$/,
					exclude: /node_modules/,
					use: {
						loader: 'babel-loader',
						options: {
							presets: [
								['@babel/preset-env', { useBuiltIns: false }],
							],
						},
					},
				},
				{
					test: /\.tsx?$/,
					exclude: /node_modules/,
					use: {
						loader: 'ts-loader',
						options: {
							compilerOptions: {
								target: 'ES2022'
							}
						}
					},
				},
				{
					test: /\.s?css$/,
					exclude: path.resolve(__dirname, './src/dom'),
					use: [
						MiniCssExtractPlugin.loader,
						{
							loader: 'css-loader',
						},
						{
							loader: 'postcss-loader',
						},
						{
							loader: 'sass-loader',
						},
					]
				},
				{
					test: /\.scss$/,
					include: path.resolve(__dirname, './src/dom'),
					use: [
						{
							loader: 'raw-loader',
						},
						{
							loader: 'sass-loader',
							options: {
								additionalData: `$platform: '${build}';`
							}
						}
					]
				}
			],
		},
		resolve: {
			extensions: ['.js', '.ts', '.tsx']
		},
		plugins: [
			new CleanWebpackPlugin({
				cleanOnceBeforeBuildPatterns: ['**/*', '!pdf/**']
			}),
			new MiniCssExtractPlugin({
				filename: '[name].css',
			}),
			new HtmlWebpackPlugin({
				template: './index.view.html',
				filename: './[name].html',
				templateParameters: {
					build
				},
			}),
		],
	};

	if (build === 'view-dev') {
		config.plugins.push(
			new CopyWebpackPlugin({
				patterns: [
					{ from: 'demo/epub/demo.epub', to: './' },
					{ from: 'demo/snapshot/demo.html', to: './' }
				],
				options: {

				}
			})
		);
		config.devServer = {
			static: {
				directory: path.resolve(__dirname, 'build/'),
				watch: true,
			},
			devMiddleware: {
				writeToDisk: true,
			},
			open: '/view-dev/view.html?type=snapshot',
			port: 3001,
		};
	}

	return config;
}

module.exports = [
	generateReaderConfig('zotero'),
	generateReaderConfig('web'),
	generateReaderConfig('esm'),
	generateReaderConfig('dev'),
	generateViewConfig('ios'),
	generateViewConfig('android'),
	generateViewConfig('view-dev'),
];
