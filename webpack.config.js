const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

function generateConfig(build) {
	let config = {
		name: build,
		mode: build === 'dev' ? 'development' : 'production',
		devtool: build === 'zotero' ? false : 'source-map',
		entry: {
			reader: ['./src/index.' + build + '.js', './src/common/stylesheets/main.scss']
		},
		output: {
			path: path.resolve(__dirname, './build/' + build),
			filename: 'reader.js',
			libraryTarget: 'umd',
			publicPath: '',
			library: {
				name: 'reader',
				type: 'umd',
				umdNamedDefine: true,
			},
		},
		optimization: {
			minimize: true,
			minimizer: [new CssMinimizerPlugin()],
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
					use: 'ts-loader',
				},
				{
					test: /\.s?css$/,
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
					],
				},
				{
					test: /\.(svg|png)$/,
					type: 'asset/resource',
					generator: {
						filename: 'assets/icons/[name].[hash:8][ext]',
					},
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
				template: './index.html',
				filename: './[name].html',
				templateParameters: {
					build
				},
			}),
		],
	};

	if (build === 'zotero') {
		config.externals = {
			react: 'React',
			'react-dom': 'ReactDOM',
			'react-intl': 'ReactIntl',
			'prop-types': 'PropTypes'
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
			open: '/dev/editor.html',
			port: 3000,
		};
	}


	return config;
}

module.exports = [
	generateConfig('zotero'),
	generateConfig('web'),
	generateConfig('dev')
];
