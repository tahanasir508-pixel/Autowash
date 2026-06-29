const bcrypt = require('bcrypt')
let client;

const setClient = (dbClient) => {
    client = dbClient;
};

//for registering user
const registeruser = async (req,res)=> {
    try {
        const {username , password , email , role = 'user'} = req.body
        const existinguser =await client.query(
            'SELECT * FROM users WHERE username = $1 OR email = $2', [username, email]
        );
        if(existinguser.rows.length > 0 ){
            return res.status(400).json({ message: 'Username or email already exists' });
        }
        const passwordHash =await bcrypt.hash(password,10)
        const result = await client.query(
            `INSERT INTO users (username, password_hash, email, role) 
            VALUES ($1, $2, $3, $4) 
            RETURNING id, username, email, role, created_at`,
            [username, passwordHash, email, role]
        );
        res.status(201).json({ message: 'User registered successfully', user: result.rows[0] }) ;           
    } catch(error) {
        res.status(400).json({error: error.message})
    }
}

//for login user
const loginuser = async (req,res)=>{
    try{
    const {username , password} = req.body;
    const result =await client.query('SELECT * FROM users WHERE username = $1 AND is_active = true',
    [username]
    );
     if (result.rows.length === 0) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        const user = result.rows[0];
        // Verify password
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);       
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        await client.query(
            'UPDATE users SET last_login = $1 WHERE id = $2',
            [new Date(), user.id]
        );

        const token = 'auth-' + Date.now() + '-' + user.id;
        
        // Store in sessions (from your existing code)
        req.app.get('sessions').set(token, {
            id: user.id,
            username: user.username,
            role: user.role,
            loginTime: new Date()
        });

        res.json({
            success: true,
            token: token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role
            },
            message: 'Login successful'
        });
    } catch (error) {
        console.error('Error logging in:', error);
        res.status(500).json({ message: 'Error logging in', error: error.message });
    }
};

module.exports={
    loginuser,
    registeruser,
    setClient
}
