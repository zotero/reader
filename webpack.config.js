const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const ZoteroLocalePlugin = require('./webpack.zotero-locale-plugin');
const { EnvironmentPlugin } = require('webpack');

function generateReaderConfig(build) {
	let config = {
		name: build,
		mode: build === 'dev' ? 'development' : 'production',
		devtool: (build === 'zotero' || build === 'web') ? false : 'source-map',
		entry: {
			reader: [
				'./src/index.' + build + '.js',
				'./src/common/stylesheets/main.scss'
			],
			...(build === 'zotero'
				? {
					'read-aloud-first-run': './src/index.read-aloud-first-run.js',
					'read-aloud-voices': './src/index.read-aloud-voices.js',
				}
				: {}),
		},
		output: {
			path: path.resolve(__dirname, './build/' + build),
			filename: '[name].js',
			libraryTarget: 'umd',
			publicPath: '',
			library: {
				name: '[name]',
				type: 'umd',
				umdNamedDefine: true,
			},
		},
		optimization: {
			minimize: build === 'web',
			minimizer: [
				new CssMinimizerPlugin(),
				new TerserPlugin({ terserOptions: { compress: { passes: 2 } } }),
			],
		},
		module: {
			rules: generateRules(build),
		},
		resolve: {
			extensions: ['.js', '.ts', '.tsx'],
		},
		plugins: [
			build !== 'zotero' && new ZoteroLocalePlugin({
				files: [
					'zotero.ftl',
					'reader.ftl',
					{ src: 'app/assets/branding/locale/brand.ftl', dest: 'brand.ftl' },
				],
				locales: ['en-US'],
				commitHash: '69002c122df40021ae50d7a32701677e62076831',
			}),
			new CleanWebpackPlugin({
				cleanOnceBeforeBuildPatterns: ['**/*', '!pdf/**']
			}),
			new MiniCssExtractPlugin({
				filename: '[name].css',
			}),
			new HtmlWebpackPlugin({
				template: './index.reader.html',
				filename: './reader.html',
				chunks: ['reader'],
				templateParameters: {
					build
				},
			}),
			build === 'zotero' && new HtmlWebpackPlugin({
				template: './index.read-aloud-first-run.html',
				filename: './read-aloud-first-run.html',
				chunks: ['read-aloud-first-run'],
				templateParameters: {
					build
				},
			}),
			build === 'zotero' && new HtmlWebpackPlugin({
				template: './index.read-aloud-voices.html',
				filename: './read-aloud-voices.html',
				chunks: ['read-aloud-voices'],
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
		].filter(Boolean),
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
		// Mimic upstream pdf.js production build by defining PDFJSDev so that
		// dev-only validation code is eliminated as dead code by terser
		config.plugins.push(
			new webpack.DefinePlugin({
				'typeof PDFJSDev': JSON.stringify('object'),
				PDFJSDev: '({ test: () => false })',
			})
		);
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
			}),
			new EnvironmentPlugin({
				ZOTERO_API_KEY: null,
			}),
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
			rules: generateRules(build),
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

function generateRules(build) {
	return [
		{
			test: /\.(ts|js)x?$/,
			include: path.resolve(__dirname, './src'),
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
		build.endsWith('dev') && {
			test: /\.tsx?$/,
			include: path.resolve(__dirname, './src'),
			use: 'ts-loader',
		},
		{
			test: /\.s?css$/,
			include: path.resolve(__dirname, './src'),
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
			include: path.resolve(__dirname, './res/icons'),
			issuer: /\.[jt]sx?$/,
			use: ['@svgr/webpack'],
		},
		{
			test: /\.ftl$/,
			include: path.resolve(__dirname, './locales'),
			type: 'asset/source'
		},
	];
}

module.exports = [
	generateReaderConfig('zotero'),
	generateReaderConfig('web'),
	generateReaderConfig('dev'),
	generateViewConfig('ios'),
	generateViewConfig('android'),
	generateViewConfig('view-dev'),
];
