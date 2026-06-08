const SUPABASE_URL = "https://cjjmyumkkpbtzsgmdgov.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqam15dW1ra3BidHpzZ21kZ292Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyMzAyMTQsImV4cCI6MjA5NTgwNjIxNH0.t4aRaGIpE5t_srEMT6DNy5HGJ5NaVNAE9tD0oYTQfq8";

async function test() {
  console.log("Fetching from parking_slots...");
  try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/parking_slots?select=*`, {
          headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          }
      });
      const data = await res.json();
      console.log("Data:", Array.isArray(data) ? data.length + " rows" : data);
      
      if (Array.isArray(data) && data.length === 0) {
          console.log("Attempting a test insert...");
          const res2 = await fetch(`${SUPABASE_URL}/rest/v1/parking_slots`, {
              method: 'POST',
              headers: {
                  'apikey': SUPABASE_ANON_KEY,
                  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                  'Content-Type': 'application/json',
                  'Prefer': 'return=representation'
              },
              body: JSON.stringify({
                  id: 'test-1',
                  floor: '1',
                  number: 'T1',
                  type: 'Car',
                  status: 'Available',
                  vehicle: null,
                  reservation: null
              })
          });
          const data2 = await res2.json();
          console.log("Insert response:", data2);
      }
  } catch (e) {
      console.error(e);
  }
}

test();
