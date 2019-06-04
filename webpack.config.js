const path = require('path');
const ExtractTextPlugin = require('extract-text-webpack-plugin');

const configWeb = {
	entry: ['./src/index.web.js'],
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
				test: /\.css$/,
				use: ExtractTextPlugin.extract({
					fallback: 'style-loader',
					use: 'css-loader',
					
				})
			}
		]
	},
	resolve: {
		extensions: ['*', '.js']
	},
	devServer: {
		port: 3000,
		contentBase: path.join(__dirname, 'build/'),
		openPage: 'web/viewer.html',
		open: true
	},
	plugins: [
		new ExtractTextPlugin("web/annotator.css"),
	]
};

const configZotero = {
	entry: ['./src/index.zotero.js'],
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
				test: /\.css$/,
				use: ExtractTextPlugin.extract({
					fallback: 'style-loader',
					use: 'css-loader',
					
				})
			}
		]
	},
	resolve: {
		extensions: ['*', '.js']
	},
	
	plugins: [
		new ExtractTextPlugin("annotator.css")
	],
	externals: {
		"react": "React",
		"react-dom": "ReactDOM",
		"re-resizable": "re-resizable",
		"react-draggable": "ReactDraggable"
	}
};

module.exports = [configWeb, configZotero];
