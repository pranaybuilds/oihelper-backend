const getAccessToken = async (req, res) => {
    const loginId = process.env.loginId
    const product = process.env.product
    const apikey = process.env.apikey

    res.json({
        loginId: process.env.loginId,
        product: process.env.product,
        apikey: process.env.apikey
    })
}

module.exports = { getAccessToken };