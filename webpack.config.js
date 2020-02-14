const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const WriteFilePlugin = require('write-file-webpack-plugin');

const configWeb = {
  devtool: 'source-map',
	entry: [
		'./src/index.web.js',
		'./src/stylesheets/main.scss'
	],
	output: {
		path: path.join(__dirname, './build'),
		filename: 'web/annotator.js',
		library: 'pdf-reader',
		libraryTarget: 'umd',
		publicPath: '/',
		umdNamedDefine: true
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
							"@babel/preset-react",
							[
								'@babel/preset-env', {}
							]
						],
						"plugins": [
							"@babel/plugin-transform-runtime",
							"@babel/plugin-proposal-class-properties"
						]
					}
				}
			},
			{
				test: /\.scss$/,
				use: [
					{
						loader: 'file-loader',
						options: {
							name: 'web/viewer.css',
						}
					},
					{
						loader: 'extract-loader'
					},
					{
						loader: 'css-loader',
						options: {
							sourceMap: true,
							url: false
						},
					},
					{
						loader: 'sass-loader',
						options: {
							sourceMap: true,
						}
					}
				]
			}
		]
	},
	resolve: {
		extensions: ['*', '.js']
	},
	plugins: [
		new CopyWebpackPlugin([
				{from: 'res/', to: 'web/'}
			], {copyUnmodified: true}
		),
		new WriteFilePlugin()
	],
	devServer: {
		port: 3000,
		contentBase: path.join(__dirname, 'build/'),
		openPage: 'web/viewer.html',
		open: false,
		watchOptions: {
			poll: true
		}
	}
};

const configZotero = {
	entry: [
		'./src/index.zotero.js',
		'./src/stylesheets/main.scss'
	],
	output: {
		path: path.join(__dirname, './build/zotero'),
		filename: 'annotator.js',
		library: 'pdf-reader',
		libraryTarget: 'umd',
		publicPath: '/',
		umdNamedDefine: true
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
							"@babel/preset-react",
							[
								'@babel/preset-env', {
								useBuiltIns: false
							}
							]
						
						],
						"plugins": [
							"@babel/plugin-transform-runtime",
							"@babel/plugin-proposal-class-properties"
						]
					}
				}
			},
			{
				test: /\.scss$/,
				use: [
					{
						loader: 'file-loader',
						options: {
							name: 'viewer.css',
						}
					},
					{
						loader: 'extract-loader'
					},
					{
						loader: 'css-loader?-url'
					},
					{
						loader: 'postcss-loader'
					},
					{
						loader: 'sass-loader'
					}
				]
			}
		]
	},
	resolve: {
		extensions: ['*', '.js']
	},
	plugins: [
		new CopyWebpackPlugin([
				{from: 'res/', to: ''}
			], {copyUnmodified: true}
		)
	],
	externals: {
		"react": "React",
		"react-dom": "ReactDOM",
		"re-resizable": "re-resizable",
		"react-draggable": "ReactDraggable"
	}
};

module.exports = [configWeb, configZotero];
