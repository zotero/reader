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
	],
	plugins: ['@babel/plugin-transform-runtime'],
};
