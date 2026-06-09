// ==========================================================================
// PARKPRO.IN AUTHENTICATION ENGINE
// ==========================================================================

const SUPABASE_URL = "https://cjjmyumkkpbtzsgmdgov.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqam15dW1ra3BidHpzZ21kZ292Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyMzAyMTQsImV4cCI6MjA5NTgwNjIxNH0.t4aRaGIpE5t_srEMT6DNy5HGJ5NaVNAE9tD0oYTQfq8";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let isLoginMode = true;

// DOM Elements
const authForm = document.getElementById('auth-form');
const btnLoginTab = document.getElementById('btn-tab-login');
const btnSignupTab = document.getElementById('btn-tab-signup');
const btnSubmit = document.getElementById('btn-submit');
const errorMsg = document.getElementById('auth-error');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');

// Toggle between Sign In / Sign Up
if (btnLoginTab && btnSignupTab) {
    btnLoginTab.addEventListener('click', () => {
        isLoginMode = true;
        btnLoginTab.classList.add('active');
        btnSignupTab.classList.remove('active');
        btnSubmit.textContent = 'Sign In';
        errorMsg.style.display = 'none';
    });

    btnSignupTab.addEventListener('click', () => {
        isLoginMode = false;
        btnSignupTab.classList.add('active');
        btnLoginTab.classList.remove('active');
        btnSubmit.textContent = 'Create Account';
        errorMsg.style.display = 'none';
    });
}

// Handle Form Submission
if (authForm) {
    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = emailInput.value;
        const password = passwordInput.value;
        
        btnSubmit.disabled = true;
        btnSubmit.textContent = 'Processing...';
        errorMsg.style.display = 'none';

        try {
            if (isLoginMode) {
                const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
                if (error) throw error;
                await handleRouting(data.user);
            } else {
                const { data, error } = await supabaseClient.auth.signUp({ email, password });
                if (error) throw error;
                
                if (data?.user?.identities?.length === 0) {
                    throw new Error("This email is already registered. Please sign in.");
                }
                
                // If email confirmation is required by Supabase settings:
                if (!data.session) {
                    alert("Account created successfully! Please check your email to verify your account before logging in.");
                    btnSubmit.disabled = false;
                    btnSubmit.textContent = 'Sign Up';
                    return;
                }
                
                await handleRouting(data.user);
            }
        } catch (err) {
            errorMsg.textContent = err.message;
            errorMsg.style.display = 'block';
            btnSubmit.disabled = false;
            btnSubmit.textContent = isLoginMode ? 'Sign In' : 'Create Account';
        }
    });
}

// Route user based on their role in the database
async function handleRouting(user) {
    if (!user) return;
    
    // Fetch user role
    const { data: roleData, error } = await supabaseClient
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .single();
        
    if (error) {
        console.error("Error fetching user role:", error);
        alert("Debug Error: Could not verify your role. Supabase says: " + error.message);
    }
        
    let role = 'user'; // default fallback
    
    if (!error && roleData && roleData.role) {
        role = roleData.role.trim().toLowerCase(); // Normalize to handle extra spaces
    }
    
    if (role === 'admin') {
        window.location.href = 'admin/admin.html';
    } else {
        window.location.href = 'user/user.html';
    }
}

// Auto-redirect if already logged in when visiting index.html
window.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session && window.location.pathname.endsWith('index.html')) {
        await handleRouting(session.user);
    }
});
