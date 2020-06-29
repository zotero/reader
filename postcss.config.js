let ex = {
  plugins: {
    'autoprefixer': {}
  }
};

if (process.env.NODE_ENV === 'production') {
  // ex.plugins['postcss-rtl'] = {
  // onlyDirection: 'rtl',
    // addPrefixToSelector(selector, prefix) {
    //   return (prefix === '[dir]' ? '' : (prefix + ' ')) + selector;
  // }
  // }
}
module.exports = ex;
