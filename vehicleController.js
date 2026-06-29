let client; // This will be set from index.js

const setClient = (dbClient) => {
    client = dbClient;
};

const generateToken = () => {
    return `WASH${Date.now().toString().slice(-6)}`;
}

const checkAndUpdateCompletedVehicles = async () => {
    try {
        const now = new Date();
        
        const result = await client.query(
            'SELECT * FROM vehicles WHERE status = $1',
            ['pending']
        );
        
        const pendingVehicles = result.rows;
        
        for (let vehicle of pendingVehicles) {
            try {
                if (vehicle.estimated_completion_time && now >= new Date(vehicle.estimated_completion_time)) {
                    await client.query(
                        'UPDATE vehicles SET status = $1, completed_at = $2, updated_at = $3 WHERE id = $4',
                        ['completed', new Date(), new Date(), vehicle.id]
                    );
                    console.log(`Auto-completed: ${vehicle.number_plate}`);
                }
            } catch (vehicleError) {
                console.log('Error processing vehicle:', vehicle.id, vehicleError.message);
                continue;
            }
        }
    } catch (error) {
        console.log('Auto-completion check skipped:', error.message);
    }
}

// Adding a vehicle
const addvehicle = async (req, res) => {
    try {
        const { vehicle, number_plate, assigned_lane, price, wash_time } = req.body;
        const enteredbyuser = req.user.id; 
        if (!enteredbyuser) {
            return res.status(400).json({message: 'User ID (enteredbyuser) is required'});
        }
        // Check if number plate already exists
        const existingVehicle = await client.query(
            'SELECT * FROM vehicles WHERE number_plate = $1',
            [number_plate]
        );
        
        if (existingVehicle.rows.length > 0) {
            return res.status(400).json({message: 'Number plate already exists in the system!'});
        }
        
        const token = generateToken();
        
        // Calculate estimated completion time based on wash time
        let washMinutes = 15; // default for Car
        if (wash_time.includes('10')) washMinutes = 10; // Bike
        if (wash_time.includes('20')) washMinutes = 20; // Truck
      
         const lastVehicleInLane = await client.query(
            `SELECT estimated_completion_time 
             FROM vehicles 
             WHERE assigned_lane = $1 AND status = 'pending'
             ORDER BY estimated_completion_time DESC 
             LIMIT 1`,
            [assigned_lane]
        );

        let estimatedCompletionTime;

        if (lastVehicleInLane.rows.length > 0) {
            const lastCompletionTime = new Date(lastVehicleInLane.rows[0].estimated_completion_time);
            estimatedCompletionTime = new Date(lastCompletionTime.getTime() + washMinutes * 60000);
        } else {
            estimatedCompletionTime = new Date();
            estimatedCompletionTime.setMinutes(estimatedCompletionTime.getMinutes() + washMinutes);
        }



        // Insert new vehicle
        const result = await client.query(
            `INSERT INTO vehicles 
             (vehicle, number_plate,ENTEREDBYUSER, assigned_lane, price, wash_time, token, estimated_completion_time, status, created_at, updated_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
             RETURNING *`,
            [
                vehicle,
                number_plate,
                enteredbyuser,
                assigned_lane,
                price,
                wash_time,
                token,
                estimatedCompletionTime,
                'pending',
                new Date(),
                new Date()
            ]
        );

        await checkAndUpdateCompletedVehicles();
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error adding vehicle:', error);
        
        // Handle PostgreSQL constraint violations
        if (error.code === '23514') { // check constraint violation
            return res.status(400).json({message: 'Invalid data provided. Check vehicle type, lane, price, or wash time.'});
        }
        if (error.code === '23505') { // unique constraint violation
            return res.status(400).json({message: 'Number plate or token already exists.'});
        }
        
        res.status(400).json({message: 'Issue adding a vehicle', error: error.message});
    }
}

// Getting all vehicles
const getvehicle = async (req, res) => {
    try {
        await checkAndUpdateCompletedVehicles();
        
        const result = await client.query(
            'SELECT * FROM vehicles ORDER BY created_at DESC'
        );
        
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error getting vehicles:', error);
        res.status(400).json({message: 'Issue getting vehicles', error: error.message});
    }
}

// Marking a specific vehicle wash completed
const washvehicle = async (req, res) => {
    try {
        const { id } = req.params;
        
        const vehicleResult = await client.query(
            'SELECT * FROM vehicles WHERE id = $1',
            [id]
        );
        
        if (vehicleResult.rows.length === 0) {
            return res.status(404).json({message: 'No vehicle found with this ID'});
        }
        
        const vehicle = vehicleResult.rows[0];
        
        if (vehicle.status === "pending") {
            await client.query(
                'UPDATE vehicles SET status = $1, completed_at = $2, updated_at = $3 WHERE id = $4',
                ['completed', new Date(), new Date(), id]
            );
            
            res.status(200).json({message: 'Vehicle status updated from pending to completed'});
        } else {
            return res.status(400).json({
                success: false,
                message: `Vehicle is already ${vehicle.status}`
            });
        }
    } catch (error) {
        console.error('Error updating vehicle status:', error);
        res.status(500).json({message: 'Internal server error while updating status', error: error.message});
    }
}

// Receipt of completed car wash
const receipt = async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await client.query(
            'SELECT * FROM vehicles WHERE id = $1',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({message: 'Vehicle not found'});
        }
        
        const vehicle = result.rows[0];
        
        if (vehicle.status !== "completed") {
            return res.status(200).json({
                message: 'Vehicle not washed yet!',
            });
        }
        
        res.status(200).json(vehicle);
    } catch (error) {
        console.error('Error getting receipt:', error);
        res.status(400).json({message: 'Error getting receipt', error: error.message});
    }
}

module.exports = {
    setClient,  // ← ADD THIS to exports
    addvehicle,
    getvehicle,
    washvehicle,
    receipt,
    checkAndUpdateCompletedVehicles 
}