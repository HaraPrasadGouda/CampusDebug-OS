import axios from 'axios';

const SAMPLE_TICKETS = [
  // Block B - Plumbing Cluster (3 tickets)
  {
    complaintText: "Water tap in washroom is leaking continuously creating noise.",
    hostelBlock: "Block B",
    floor: "3rd Floor",
    room: "304",
    category: "Plumbing"
  },
  {
    complaintText: "Low water pressure in 3rd floor east wing purifier valve.",
    hostelBlock: "Block B",
    floor: "3rd Floor",
    room: "305",
    category: "Plumbing"
  },
  {
    complaintText: "Flush tank not filling water properly in washroom.",
    hostelBlock: "Block B",
    floor: "3rd Floor",
    room: "306",
    category: "Plumbing"
  },

  // Girls Hostel 1 - Mess & Cleanliness Cluster (4 tickets)
  {
    complaintText: "Mess floor is extremely dirty and has oil spills after breakfast.",
    hostelBlock: "Girls Hostel 1",
    floor: "Ground Floor",
    room: "101",
    category: "Cleanliness"
  },
  {
    complaintText: "Corridor trash can overflow and unhygienic waste smells.",
    hostelBlock: "Girls Hostel 1",
    floor: "Ground Floor",
    room: "102",
    category: "Cleanliness"
  },
  {
    complaintText: "Food counter plates not washed properly in mess hall.",
    hostelBlock: "Girls Hostel 1",
    floor: "Ground Floor",
    room: "104",
    category: "Cleanliness"
  },
  {
    complaintText: "Mess floor cleaning required immediately near entry gate.",
    hostelBlock: "Girls Hostel 1",
    floor: "Ground Floor",
    room: "105",
    category: "Cleanliness"
  },

  // Block A - Electrical & Wiring Cluster (4 tickets)
  {
    complaintText: "Corridor main tube light is flickering continuously.",
    hostelBlock: "Block A",
    floor: "2nd Floor",
    room: "201",
    category: "Electrical"
  },
  {
    complaintText: "Ceiling fan speed regulator sparking when turned to max.",
    hostelBlock: "Block A",
    floor: "2nd Floor",
    room: "202",
    category: "Electrical"
  },
  {
    complaintText: "Corridor MCB tripped leaving 2nd floor wing in darkness.",
    hostelBlock: "Block A",
    floor: "2nd Floor",
    room: "204",
    category: "Electrical"
  },
  {
    complaintText: "Switch board socket loose and sparking on plug insertion.",
    hostelBlock: "Block A",
    floor: "2nd Floor",
    room: "205",
    category: "Electrical"
  },

  // Block C - Wi-Fi / LAN Network Cluster (4 tickets)
  {
    complaintText: "Hostel Wi-Fi router packet loss on 4th floor corridor.",
    hostelBlock: "Block C",
    floor: "4th Floor",
    room: "401",
    category: "Wi-Fi / LAN"
  },
  {
    complaintText: "Cisco Access Point blinking orange and dropping connection.",
    hostelBlock: "Block C",
    floor: "4th Floor",
    room: "402",
    category: "Wi-Fi / LAN"
  },
  {
    complaintText: "LAN port #4 in room disconnected completely since morning.",
    hostelBlock: "Block C",
    floor: "4th Floor",
    room: "405",
    category: "Wi-Fi / LAN"
  },
  {
    complaintText: "High latency and frequent disconnections on 4th floor Wi-Fi.",
    hostelBlock: "Block C",
    floor: "4th Floor",
    room: "408",
    category: "Wi-Fi / LAN"
  }
];

async function seedTickets() {
  console.log('🚀 Starting automated seed of 15 student tickets to /api/parse-ticket...');
  let successCount = 0;

  for (let i = 0; i < SAMPLE_TICKETS.length; i++) {
    const ticket = SAMPLE_TICKETS[i];
    try {
      console.log(`\n[${i + 1}/15] Submitting ticket for ${ticket.hostelBlock} ${ticket.floor} Room #${ticket.room}...`);
      const response = await axios.post('http://localhost:5000/api/parse-ticket', ticket, { timeout: 30000 });

      if (response.data && response.data.success) {
        successCount++;
        console.log(`✅ Seeded: ${response.data.ticket.id} | Clustered: ${response.data.clustered ? 'YES 🎯' : 'NO'}`);
      }
    } catch (err) {
      console.error(`❌ Failed seeding ticket #${i + 1}:`, err.message);
    }
  }

  console.log(`\n🎉 Seeding finished! Successfully created ${successCount}/15 tickets.`);
}

seedTickets();
