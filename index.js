const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const port = process.env.PORT || 5000;
const stripe = require("stripe")('sk_test_51MypPDFvGTQxqWfsx6YeOJo4q6BU4U1PWxGO0q70knt1kQW8AkDTdtgLEWYlAB6pdakDqwhx4xenF4VDmZ2njdBy002pIskrzp');



const app = express();


// middleware
app.use(cors());
app.use(express.json());



const uri = "mongodb+srv://akash:akash123@cluster0.lgcbs6o.mongodb.net/?retryWrites=true&w=majority";

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});


function verifyJWT(req, res, next){
    const authHeader = req.headers.authorization;
    if(!authHeader){
        return res.status(401).send('unauthorized access');
    }

    const token = authHeader.split(' ')[1];
    jwt.verify(token, '243b7abd525f290264d6ea4d76d0e9a115b680a2ca69d8e60dd0ead66cffb4f1249dae2d01e9743b56c9250843c19582047f58adb62df52360e3200add0c7aa4', function(err, decoded){
        if(err){
            return res.status(403).send({message: 'forbidden access'})
        }
        req.decoded = decoded;
        next();
    })

}

async function run(){
    try{
        const appointmentOptionCollection = client.db('doctorsPortal').collection('appointmentOptions')

        const bookingsCollection = client.db('doctorsPortal').collection('bookings');
        const usersCollection = client.db('doctorsPortal').collection('users');
        const doctorsCollection = client.db('doctorsPortal').collection('doctors');
        const paymentCollection = client.db('doctorsPortal').collection('payments');



        const verifyAdmin = async (req, res, next) =>{
            const decodedEmail = req.decoded.email;
            const query = {email: decodedEmail};
            const user = await usersCollection.findOne(query);
            if(user?.role !== 'admin'){
                return res.status(403).send({message: 'forbidden access'})
            }
            console.log('inside verifyAdmin', req.decoded.email)
            next();
        }





        app.get('/appointmentOptions', async(req,res)=>{
            const date = req.query.date;
            console.log(date);
            const query ={};
            const options = await appointmentOptionCollection.find(query).toArray();
            const bookingQuery = {appointmentDate: date }
            const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();
            options.forEach(option => {
                const optionBooked = alreadyBooked.filter(book => book.treatment === option.name);
                const bookedSlots = optionBooked.map(book => book.slot)
                const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot))
                option.slots = remainingSlots;
            })
            res.send(options);
        })

        app.get('/bookings', verifyJWT,  async(req, res) =>{
            const email = req.query.email;
            const decodedEmail = req.decoded.email;

            if(email !== decodedEmail){
                return res.status(403).send({message: 'forbidden access'});
            }


            const query = {email: email};

            const bookings = await bookingsCollection.find(query).toArray();
            res.send(bookings);
        });


        app.get('/appointmentSpecialty', async(req,res) =>{
            const query = {}
            const result = await appointmentOptionCollection.find(query).project({name: 1}). toArray();
            res.send(result);
        });


        app.get('/bookings/:id', async(req, res) =>{
            const id = req.params.id;
            const query = {_id: new ObjectId(id)};
            const booking = await bookingsCollection.findOne(query);
            res.send(booking);
        })


        app.post('/bookings', async(req,res) =>{
            const booking = req.body
            console.log(booking);
            const query = {
                appointmentDate: booking.appointmentDate,
                email: booking.email,
                treatment: booking.treatment
            }

            const alreadyBooked = await bookingsCollection.find(query).toArray();
            if(alreadyBooked.length){
                const message = `You already have a booking on ${booking.appointmentDate}`
                return res.send({acknowledged: false, message})
            }


            const result = await bookingsCollection.insertOne(booking);
            res.send(result);
        
        
        });


        app.post('/create-payment-intent', async (req,res) =>{
            const booking = req.body;
            const price = booking.price;
            const amount = price*100;

            const paymentIntent = await stripe.paymentIntents.create({
                currency: 'usd',
                amount: amount,
                "payment_method_types": [
                    "card"
                ]
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            })

        } );

        app.post('/payments', async (req, res) =>{
            const payment = req.body;
            const result = await paymentCollection.insertOne(payment);
            const id = payment.bookingId
            const filter = {_id: new ObjectId(id)}
            const updateDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }
            const updatedResult = await bookingsCollection.updateOne(filter,updateDoc)
            res.send(result);
        })





        app.get('/jwt', async(req,res) => {
            const email = req.query.email;
            const query = {email: email};
            const user = await usersCollection.findOne(query);
            if(user){
                const token = jwt.sign({email}, '243b7abd525f290264d6ea4d76d0e9a115b680a2ca69d8e60dd0ead66cffb4f1249dae2d01e9743b56c9250843c19582047f58adb62df52360e3200add0c7aa4', {expiresIn: '1h'})
                return res.send({accessToken: token})
            }
            res.status(403).send({accessToken: 'unauthorized access'})
        });

        app.get('/users', async(req, res)=>{
            const quary = {};
            const users = await usersCollection.find(quary).toArray();
            res.send(users);
        });

        app.get('/users/admin/:email', async(req, res) => {
            const email = req.params.email;
            const query = {email}
            const user = await usersCollection.findOne(query);
            res.send({isAdmin: user?.role === 'admin'});
        });

        app.post('/users', async(req,res)=>{
            const user = req.body;
            console.log(user);
            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        app.put('/users/admin/:id', verifyJWT, async (req, res) =>{
            const decodedEmail = req.decoded.email;
            const query = {email: decodedEmail};
            const user = await usersCollection.findOne(query);
            if(user?.role !== 'admin'){
                return res.status(403).send({message: 'forbidden access'})
            }
            const id = req.params.id;
            const filter = { _id:new ObjectId(id) }
            const options = {upsert: true};
            const updateDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await usersCollection.updateOne(filter,updateDoc,options);
            res.send(result);
        });

        


  

        app.get('/doctors', verifyJWT, verifyAdmin, async(req, res) =>{
            const query = {};
            const doctors = await doctorsCollection.find(query).toArray();
            res.send(doctors);
        });

        app.post('/doctors',verifyJWT, verifyAdmin, async(req, res) =>{
            const doctor = req.body;
            const result = await doctorsCollection.insertOne(doctor);
            res.send(result);
        });

        app.delete('/doctors/:id', verifyJWT, verifyAdmin, async (req, res) =>{
            const id = req.params.id;
            const filter = {_id: new ObjectId(id)};
            const result = await doctorsCollection.deleteOne(filter);
            res.send(result);
        });




    }finally{

    }
}
run().catch(console.log);











app.get('/', async(req,res) =>{
    res.send('doctors portal is running');
})

app.listen(port, () => console.log(`Doctors portal running on ${port}`))
