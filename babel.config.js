module.exports = {
	presets: [
		'@babel/preset-react',
		[
			'@babel/preset-env',
			{
				modules: false,
				useBuiltIns: 'usage',
				corejs: { version: '3.24', proposals: true },
			},
		],
		'@babel/preset-typescript',
	],
	plugins: ['@babel/plugin-transform-runtime'],
};
