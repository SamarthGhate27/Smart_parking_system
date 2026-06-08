const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = "https://cjjmyumkkpbtzsgmdgov.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqam15dW1ra3BidHpzZ21kZ292Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyMzAyMTQsImV4cCI6MjA5NTgwNjIxNH0.t4aRaGIpE5t_srEMT6DNy5HGJ5NaVNAE9tD0oYTQfq8";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function test() {
  console.log("Fetching from parking_slots...");
  const { data, error } = await supabase.from('parking_slots').select('*');
  console.log("Data:", data ? data.length + " rows" : null);
  console.log("Error:", error);
  
  if (data && data.length === 0) {
      console.log("Attempting a test insert...");
      const { data: iData, error: iErr } = await supabase.from('parking_slots').insert([
          {
              id: 'test-1',
              floor: '1',
              number: 'T1',
              type: 'Car',
              status: 'Available',
              vehicle: null,
              reservation: null
          }
      ]);
      console.log("Insert Data:", iData);
      console.log("Insert Error:", iErr);
  }
}

test();
